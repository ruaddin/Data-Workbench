/* ==========================================================================
   DW.engine — the retained session. The Worker owns the data; the main thread
   owns the intent. Both drive this same object: the Worker through its command
   loop, the main thread directly when a Worker is unavailable or the format is
   whole-document (W4, plus the Data Skeleton fallback).

   Every command that can exceed about a second is async and yields periodically
   (W27). That is not cosmetic: a Worker cannot receive `{c:'cancel'}` while a
   synchronous loop holds its event loop, so yielding is the only thing that makes
   Cancel deliverable at all. Progress out of a Worker needs no such thing —
   postMessage mid-loop queues and the main thread drains it as it idles.
   ========================================================================== */

const engine = (function(){

const S = {records:[], model:null, warnings:[], acc:null, cancelled:false};

function warn(w){ if(S.warnings.length < 5000) S.warnings.push(w); }

// A real macrotask yield, which is what lets a queued message run. Available in
// both a Worker and the main-thread fallback; no DOM reference, per dw-core's rule.
function breathe(){ return new Promise(function(r){ setTimeout(r, 0); }); }

const PROGRESS_MS = 120;        // the throttle the scan already uses

// Wraps an emit callback as the control object `fix.scanPath` expects: a
// time-based yield, a cancel probe, and progress throttled to ~120 ms. The tallies
// reported are the ones already shown when an unpack finishes — shown while you
// wait instead of only afterwards.
function control(emit, op, total){
  let last = 0;
  return {
    breathe: breathe,
    total: total,
    cancelled: function(){ return S.cancelled; },
    tick: function(p){
      const now = Date.now();
      if(now - last < PROGRESS_MS) return;
      last = now;
      p.t = "progress";
      p.op = op;
      emit(p);
    }
  };
}

const NO_EMIT = function(){};

async function scan(src, format, opts, emit){
  S.records = [];
  S.warnings = [];
  S.model = null;
  S.cancelled = false;
  // The repair memo is keyed by content and self-invalidating, so clearing here
  // bounds memory rather than doing correctness work (W26).
  fix.clearCache();

  const ctx = {
    delimiter:opts.delimiter, recordPath:opts.recordPath,
    enumMax:opts.enumMax, mapMax:opts.mapMax, bytes:0, warn:S.warnings,
    breathe:opts.breathe
  };
  const acc = skeleton(ctx);
  S.acc = acc;

  let n = 0, errCount = 0, ragged = 0, lastProg = 0, lastPartial = 0, sliceSent = false;

  for await (const r of readers.record(src, format, ctx)){
    if(S.cancelled) return null;
    if(r.ok){
      S.records.push(r.value);
      acc.add(r.value);
      n++;
      if(r.ragged){
        ragged++;
        if(ragged <= 200) warn({kind:"ragged", line:r.line, detail:"row field count differs from the header"});
      }
    } else {
      errCount++;
      warn({kind:"parse", line:r.line, detail:r.msg});
    }

    if((n & 255) === 0 || n === 1000){
      const now = Date.now();
      if(!sliceSent && n >= 200){ sliceSent = true; emit({t:"slice", records:S.records.slice(0, 200)}); }
      if(now - lastProg > PROGRESS_MS){
        lastProg = now;
        emit({t:"progress", op:"scan", bytes:ctx.bytes || 0, records:n, errCount:errCount});
      }
      // Provisional model at most every ~250 ms (W13): the tree appears within
      // about a second and refines, rather than holding a bar for a minute.
      if(n >= 1000 && now - lastPartial > 250){
        lastPartial = now;
        emit({t:"partial", model:acc.snapshot(), records:n});
      }
      if(ctx.breathe) await ctx.breathe();
    }
  }

  if(!sliceSent) emit({t:"slice", records:S.records.slice(0, 200)});
  S.model = acc.finish();
  return {model:S.model, records:n, errCount:errCount, ragged:ragged,
          misses:ctx.misses || 0, bytes:ctx.bytes || 0, warnings:S.warnings};
}

// How many string values sit at a path — the exact denominator for unpack's
// progress count, straight off the skeleton rather than from a counting pass.
function strCount(node){ return (node && node.types.get("str")) || 0; }

// Repairs a path's values and grafts the discovered structure into the skeleton
// as real children — full presence math, type badges, checkboxes (W9). Recursion
// is manual: a child that is itself embedded JSON gets its own toggle.
//
// Cancelling leaves the model exactly as it was: the graft is the last thing that
// happens, and it does not happen at all if the scan came back cancelled.
async function unpack(path, emit, op){
  S.cancelled = false;
  const node = nodeAt(S.model, path);
  if(!node) return {t:"fail", msg:"path not found: " + path};
  const res = await fix.scanPath(S.records, path, control(emit || NO_EMIT, op || "unpack", strCount(node)));
  if(res.cancelled) return {t:"cancelled"};

  const sub = skeleton({enumMax:S.model.enumMax, mapMax:S.model.mapMax});
  for(const v of res.values) sub.add(v);
  const subModel = sub.finish();
  node.children = subModel.root.children;
  node.unpacked = true;
  for(const d of res.dups.slice(0, 200)){
    warn({kind:"dupkey", path:path, detail:'record ' + d.i + ': duplicate key "' + d.key + '" — parsing will keep the last'});
  }
  for(const r of res.residue.slice(0, 200)){
    warn({kind:"residue", path:path, detail:"record " + r.i + ": " + r.reason});
  }
  S.model.depth = sub.depthOf(S.model.root);
  return {t:"unpacked", path:path, model:S.model, warnings:S.warnings,
          total:res.total, parsed:res.parsed, repaired:res.repaired,
          residue:res.residue.slice(0, 5000), causes:res.causes};
}

async function residueBlob(path, emit){
  S.cancelled = false;
  const node = nodeAt(S.model, path);
  // Cheap on the second pass despite re-running every value: the repair memo
  // holds them, and the ones that could not be repaired — the entire subject of
  // this call — are exactly the entries it holds most valuably (W26).
  const res = await fix.scanPath(S.records, path, control(emit || NO_EMIT, "residue", strCount(node)));
  if(res.cancelled) return {t:"cancelled"};
  const lines = res.residue.map(function(r){
    return JSON.stringify({i:r.i, o:r.o, path:r.path, cause:r.cause, reason:r.reason, raw:r.raw});
  });
  return {t:"blob", blob:new Blob([lines.join("\n") + (lines.length ? "\n" : "")], {type:"application/x-ndjson"}),
          count:res.residue.length};
}

// Merge on record index + path: the returned file is validated before anything
// is written, and the current selection survives because it is keyed by path.
//
// This is W27's one exception to "cancel leaves state as it was". The repaired
// values are written into records before the unpack phase, so cancelling leaves
// them merged with the path not unpacked. Recoverable by re-unpacking, and the
// status line says so rather than implying nothing happened. Making it atomic
// would buy true rollback for a rare case at the cost of holding the fixed values
// twice, which W4 will not pay for.
async function merge(path, fixed, emit){
  const steps = readers.parsePath(path);
  let matched = 0;
  const missed = [];
  for(const f of fixed){
    if(!f || typeof f.i !== "number" || typeof f.raw !== "string"){ missed.push(f); continue; }
    const rec = S.records[f.i];
    if(!rec){ missed.push(f); continue; }
    if(!parses(f.raw.trim())){ missed.push(f); continue; }
    const refs = valueRefs(rec, steps);
    const o = typeof f.o === "number" ? f.o : 0;
    if(!refs[o]){ missed.push(f); continue; }
    refs[o].o[refs[o].k] = f.raw;
    matched++;
  }
  S.warnings = S.warnings.filter(function(w){ return !(w.kind === "residue" && w.path === path); });
  const re = await unpack(path, emit, "merge");
  if(re.t === "cancelled") return {t:"cancelled", matched:matched};
  re.matched = matched;
  re.missed = missed.length;
  return re;
}

async function exportData(opts, emit){
  S.cancelled = false;
  emit = emit || NO_EMIT;
  const chunks = [];
  let rows = 0, last = 0;
  const sink = {
    warn: function(w){ warn(w); },
    tick: function(n){
      rows = n;
      const now = Date.now();
      if(now - last > PROGRESS_MS){ last = now; emit({t:"progress", op:"export", rows:n, total:S.records.length}); }
    }
  };
  // Yields between chunks rather than between rows: `run` is a generator that
  // emits every ~1,000 rows, which is a fine granularity for uniformly-priced
  // rows. Cancel therefore lags by at most one chunk.
  let lastYield = Date.now();
  for(const c of pipeline.run(S.records, opts, sink)){
    chunks.push(c);
    const now = Date.now();
    if(now - lastYield < fix.YIELD_MS) continue;
    lastYield = now;
    await breathe();
    if(S.cancelled) return {t:"cancelled"};
  }
  // Blob parts are moved out of the JS heap by the browser, so the assembled
  // output never counts against it (W4).
  const type = opts.format === "csv" ? "text/csv" : "application/x-ndjson";
  return {t:"blob", blob:new Blob(chunks, {type:type}), rows:rows, warnings:S.warnings};
}

/* ==========================================================================
   estimate (W28) — how long Unpack will take on this path.

   Counts come from triage during the scan and are exact. The *timing* needs
   measured throughput, which needs real `repair` runs, which is the one thing
   that can stall for seconds on a single value — so it does not run at scan. It
   runs here, in the Worker, when a path's detail pane opens: records live here
   and a pathological value delays a number rather than the UI.

   Two things the shape of this depends on:

   - **It models the Unpack button, not the fixer.** Unpack also JSON.parses every
     repaired value and builds a whole sub-skeleton over all of them, so the timed
     body does all three. Timing only the failures would understate it by the
     entire cost of the ones that were fine.
   - **Two populations, extrapolated on characters.** Clean and failing values
     differ in cost by orders of magnitude, so they are timed apart. `tokenize` is
     linear in length and the node count is bounded, so characters predict and
     count does not.
   ========================================================================== */

const SAMPLE_CAP = 30;          // values timed per population
const SAMPLE_MS = 1500;         // time box per population, whichever comes first

// Evenly spaced picks across the length-sorted population, endpoints included. A
// sample that misses the one 218 KB value in a path of short ones is wrong by
// 10×, which is exactly what stratification exists to prevent.
function stratify(list, cap){
  if(list.length <= cap) return list.slice();
  const sorted = list.slice().sort(function(a, b){ return a.len - b.len; });
  const out = [];
  for(let k = 0; k < cap; k++) out.push(sorted[Math.round(k * (sorted.length - 1) / (cap - 1))]);
  return out;
}

function valueAt(steps, e){
  const rec = S.records[e.i];
  if(!rec) return null;
  const refs = valueRefs(rec, steps);
  return refs[e.o] ? refs[e.o].o[refs[e.o].k] : null;
}

// `breathe` yields *between* values and never inside one, so a single 218 KB
// `unexpected` value can consume the entire box on its own — and that value is
// precisely the one that dominates the real cost. When the box blows, that is the
// answer, reported as a floor rather than smoothed into a soft average.
async function timePopulation(steps, entries, sub){
  const out = {ms:0, chars:0, n:0, worst:null, stopped:false, cancelled:false};
  for(const e of entries){
    const raw = valueAt(steps, e);
    if(typeof raw !== "string") continue;
    const t0 = Date.now();
    const r = fix.repair(raw);
    if(r.ok){ try{ sub.add(JSON.parse(r.out)); }catch(err){} }
    const dt = Date.now() - t0;
    out.ms += dt;
    out.chars += raw.length;
    out.n++;
    if(!out.worst || dt > out.worst.ms) out.worst = {ms:dt, i:e.i, len:raw.length};
    await breathe();
    if(S.cancelled){ out.cancelled = true; return out; }
    if(out.ms >= SAMPLE_MS){ out.stopped = out.n < entries.length; break; }
  }
  return out;
}

async function estimate(path, emit){
  S.cancelled = false;
  emit = emit || NO_EMIT;
  const node = nodeAt(S.model, path);
  if(!node) return {t:"fail", msg:"path not found: " + path};

  const steps = readers.parsePath(path);
  const clean = [], fail = [];
  let cleanChars = 0, failChars = 0, walked = 0, lastYield = Date.now(), lastProg = 0;

  // One pass to split the populations and record their lengths. Holds three
  // numbers per value and never the value itself, so it stays inside W4's budget;
  // it costs one JSON.parse per value, strictly less than the unpack it predicts.
  for(let i = 0; i < S.records.length; i++){
    const refs = valueRefs(S.records[i], steps);
    for(let o = 0; o < refs.length; o++){
      const raw = refs[o].o[refs[o].k];
      if(typeof raw !== "string") continue;
      const e = {i:i, o:o, len:raw.length};
      if(parses(raw.trim())){ clean.push(e); cleanChars += e.len; }
      else { fail.push(e); failChars += e.len; }
      walked++;
    }
    const now = Date.now();
    if(now - lastYield < fix.YIELD_MS) continue;
    lastYield = now;
    if(now - lastProg > PROGRESS_MS){
      lastProg = now;
      emit({t:"progress", op:"estimate", done:walked, total:strCount(node)});
    }
    await breathe();
    if(S.cancelled) return {t:"cancelled"};
  }

  const sub = skeleton({enumMax:S.model.enumMax, mapMax:S.model.mapMax});
  const sc = await timePopulation(steps, stratify(clean, SAMPLE_CAP), sub);
  if(sc.cancelled) return {t:"cancelled"};
  const sf = await timePopulation(steps, stratify(fail, SAMPLE_CAP), sub);
  if(sf.cancelled) return {t:"cancelled"};

  // Extrapolate each population on characters, not count.
  const rate = function(s, total){ return s.chars ? s.ms / s.chars * total : 0; };
  const ms = rate(sc, cleanChars) + rate(sf, failChars);
  const worst = (sf.worst && (!sc.worst || sf.worst.ms > sc.worst.ms)) ? sf.worst : sc.worst;

  return {t:"estimate", path:path, ms:Math.round(ms),
          total:clean.length + fail.length, clean:clean.length, fail:fail.length,
          sampled:sc.n + sf.n, stopped:sc.stopped || sf.stopped,
          worst:worst && worst.ms >= 250 ? worst : null};
}

return {
  state:S,
  scan:scan, unpack:unpack, residue:residueBlob, merge:merge, exportData:exportData,
  estimate:estimate,
  cancel(){ S.cancelled = true; },
  slice(n){ return S.records.slice(0, n); }
};
})();
