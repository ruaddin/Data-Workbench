/* ==========================================================================
   DW.engine — the retained session. The Worker owns the data; the main thread
   owns the intent. Both drive this same object: the Worker through its command
   loop, the main thread directly when a Worker is unavailable or the format is
   whole-document (W4, plus the Data Skeleton fallback).
   ========================================================================== */

const engine = (function(){

const S = {records:[], model:null, warnings:[], acc:null, cancelled:false};

function warn(w){ if(S.warnings.length < 5000) S.warnings.push(w); }

async function scan(src, format, opts, emit){
  S.records = [];
  S.warnings = [];
  S.model = null;
  S.cancelled = false;

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
      if(now - lastProg > 120){
        lastProg = now;
        emit({t:"progress", bytes:ctx.bytes || 0, records:n, errCount:errCount});
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

// Repairs a path's values and grafts the discovered structure into the skeleton
// as real children — full presence math, type badges, checkboxes (W9). Recursion
// is manual: a child that is itself embedded JSON gets its own toggle.
function unpack(path){
  const node = nodeAt(S.model, path);
  if(!node) return {t:"fail", msg:"path not found: " + path};
  const res = fix.scanPath(S.records, path);
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

function residueBlob(path){
  const res = fix.scanPath(S.records, path);
  const lines = res.residue.map(function(r){
    return JSON.stringify({i:r.i, o:r.o, path:r.path, cause:r.cause, reason:r.reason, raw:r.raw});
  });
  return {t:"blob", blob:new Blob([lines.join("\n") + (lines.length ? "\n" : "")], {type:"application/x-ndjson"}),
          count:res.residue.length};
}

// Merge on record index + path: the returned file is validated before anything
// is written, and the current selection survives because it is keyed by path.
function merge(path, fixed){
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
  const re = unpack(path);
  re.matched = matched;
  re.missed = missed.length;
  return re;
}

function exportData(opts, emit){
  const chunks = [];
  let rows = 0, last = Date.now();
  const sink = {
    warn: function(w){ warn(w); },
    tick: function(n){
      rows = n;
      const now = Date.now();
      if(now - last > 120){ last = now; emit({t:"progress", rows:n, total:S.records.length}); }
    }
  };
  for(const c of pipeline.run(S.records, opts, sink)) chunks.push(c);
  // Blob parts are moved out of the JS heap by the browser, so the assembled
  // output never counts against it (W4).
  const type = opts.format === "csv" ? "text/csv" : "application/x-ndjson";
  return {t:"blob", blob:new Blob(chunks, {type:type}), rows:rows, warnings:S.warnings};
}

return {
  state:S,
  scan:scan, unpack:unpack, residue:residueBlob, merge:merge, exportData:exportData,
  cancel(){ S.cancelled = true; },
  slice(n){ return S.records.slice(0, n); }
};
})();
