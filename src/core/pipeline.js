/* ==========================================================================
   DW.pipeline — selection → explode → flatten → split → line breaks →
   pretty-print → big-int quoting → serialise.  The order is fixed and
   load-bearing (splitter §0): flattening promotes nested strings to the top
   level *where they become eligible for splitting*, so the reverse order lets an
   over-cap value straight through.
   Preview (main thread, 200 records) and export (Worker, all records) call the
   same run(), which is why the preview cannot lie about what gets written.
   ========================================================================== */

const pipeline = (function(){

function project(v, steps, i, unpackAt){
  if(i >= steps.length) return v;
  const s = steps[i];
  if(s === "[]"){
    if(!Array.isArray(v)) return undefined;
    const out = [];
    for(const el of v){
      const r = project(el, steps, i + 1, unpackAt);
      if(r !== undefined) out.push(r);
    }
    return out;
  }
  if(s === "{*}"){
    if(!plain(v)) return undefined;
    if(i === steps.length - 1) return Object.keys(v);       // {*} means the key (W19)
    const out = {};
    for(const k in v){
      if(!has(v, k)) continue;
      const r = project(v[k], steps, i + 1, unpackAt);
      if(r !== undefined) out[k] = r;
    }
    return out;                                             // object keyed by the map key
  }
  if(!plain(v) || !has(v, s)) return undefined;
  let next = v[s];
  if(unpackAt && unpackAt.has(i) && typeof next === "string"){
    const r = fix.repair(next);
    if(!r.ok) return undefined;
    try{ next = JSON.parse(r.out); }catch(e){ return undefined; }
  }
  return project(next, steps, i + 1, unpackAt);
}

/* --- W21: packaging a container's selected subtree into one value ---
   `keep` is a list of step-arrays relative to the container. They are folded into a
   trie once per plan, then walked alongside the value. A terminal node means "keep
   everything from here down", which is what makes `{*}` (whole map) and a fully
   ticked object come out identical to the source. */

function keepTree(keep){
  const root = {end:false, kids:new Map()};
  for(const steps of keep){
    let n = root;
    for(const s of steps){
      let k = n.kids.get(s);
      if(!k){ k = {end:false, kids:new Map()}; n.kids.set(s, k); }
      n = k;
    }
    n.end = true;
  }
  return root;
}

// Iterates the *source* object's own keys rather than the trie's, so key order
// survives and a fully ticked container is byte-identical to what came in.
function prune(v, t){
  if(t.end || t.kids.size === 0) return v;
  if(Array.isArray(v)){
    const a = t.kids.get("[]");
    if(!a) return v;
    const out = [];
    for(const el of v) out.push(prune(el, a));
    return out;
  }
  if(!plain(v)) return v;
  const star = t.kids.get("{*}");
  const out = {};
  for(const k in v){
    if(!has(v, k)) continue;
    const kid = t.kids.get(k) || star;
    if(kid) out[k] = prune(v[k], kid);
  }
  return out;
}

// Elements of the one collection named by explode-by. One row unit, ever — which
// is what stops the cross-product (W5). `unpackAt` names the step indices whose
// value is embedded JSON that has to be repaired and parsed on the way through,
// so a collection that only exists after unpacking is still explodable.
function explodeUnits(rec, steps, unpackAt){
  let cur = [rec];
  for(let i = 0; i < steps.length; i++){
    const s = steps[i], last = i === steps.length - 1;
    const next = [];
    for(let v of cur){
      if(unpackAt && unpackAt.has(i - 1) && typeof v === "string"){
        const r = fix.repair(v);
        if(!r.ok) continue;
        try{ v = JSON.parse(r.out); }catch(e){ continue; }
      }
      if(s === "[]"){
        if(!Array.isArray(v)) continue;
        for(const el of v) next.push(last ? {elem:el, key:null} : el);
      } else if(s === "{*}"){
        if(!plain(v)) continue;
        for(const k in v){
          if(!has(v, k)) continue;
          next.push(last ? {elem:v[k], key:k} : v[k]);
        }
      } else {
        if(!plain(v) || !has(v, s)) continue;
        next.push(last ? {elem:v[s], key:null} : v[s]);
      }
    }
    cur = next;
    if(!cur.length) break;
  }
  return cur;
}

function startsWith(steps, pre){
  if(pre.length > steps.length) return false;
  for(let i = 0; i < pre.length; i++) if(steps[i] !== pre[i]) return false;
  return true;
}

// Computed from the skeleton model alone, without touching a record: drives the
// "9,981 records → 94,220 rows" readout and the preview table header (W5).
function plan(opts, model){
  const explodeSteps = opts.explode ? readers.parsePath(opts.explode) : null;
  const unpacked = opts.unpacked || [];
  const explodeUnpack = new Set();
  if(explodeSteps){
    for(const u of unpacked){
      const us = readers.parsePath(u);
      if(us.length && startsWith(explodeSteps, us)) explodeUnpack.add(us.length - 1);
    }
  }
  // W21. A container only packages if it is *itself* selected — its checkbox is the
  // column's on/off switch — so an entry in `whole` that nobody ticked swallows
  // nothing, and its descendants fall back to being ordinary columns.
  const sel = new Set(opts.selected);
  const wholeSteps = new Map();
  for(const w of (opts.whole || [])) if(sel.has(w)) wholeSteps.set(w, readers.parsePath(w));

  // Outer wins: a container nested inside another packaged container is already
  // part of that one's JSON. Its entry is dropped rather than kept as a waypoint,
  // because a waypoint would terminate the keep-trie and quietly restore the very
  // sub-nodes the user deselected beneath it. The UI disables the inner toggle;
  // this normalises the same case arriving from a hand-edited recipe.
  const nested = new Set();
  for(const a of wholeSteps) for(const b of wholeSteps){
    if(a[0] !== b[0] && b[1].length < a[1].length && startsWith(a[1], b[1])) nested.add(a[0]);
  }
  for(const p of nested) wholeSteps.delete(p);

  // Nearest *strict* whole ancestor. "Nearest" is what makes nested containers
  // resolve to the outer one without a special case: the outer's JSON already
  // contains the inner, so the inner never needs a column of its own.
  function hostOf(p, steps){
    let host = null, len = -1;
    for(const e of wholeSteps){
      if(e[0] === p) continue;
      if(e[1].length > len && startsWith(steps, e[1])){ host = e[0]; len = e[1].length; }
    }
    return host;
  }

  const columns = [];
  const byPath = new Map();
  const stepsOf = new Map();
  for(const p of opts.selected) stepsOf.set(p, readers.parsePath(p));

  for(const p of opts.selected){
    const steps = stepsOf.get(p);
    if(hostOf(p, steps) !== null) continue;             // packaged by an ancestor
    const unpackAt = new Set();
    for(const u of unpacked){
      const us = readers.parsePath(u);
      if(us.length && startsWith(steps, us)) unpackAt.add(us.length - 1);
    }
    const under = explodeSteps && startsWith(steps, explodeSteps);
    const col = {
      path:p, steps:steps, unpackAt:unpackAt, under:!!under,
      rest: under ? steps.slice(explodeSteps.length) : null,
      restUnpack: under ? new Set(Array.from(unpackAt)
                    .filter(function(i){ return i >= explodeSteps.length; })
                    .map(function(i){ return i - explodeSteps.length; })) : null,
      keep: wholeSteps.has(p) ? [] : null, tree: null
    };
    byPath.set(p, col);
    columns.push(col);
  }

  // Second pass: a leaf may be ordered before the container that packages it.
  for(const p of opts.selected){
    const steps = stepsOf.get(p);
    const host = hostOf(p, steps);
    if(host === null || nested.has(p)) continue;
    const col = byPath.get(host);
    if(col && col.keep) col.keep.push(steps.slice(wholeSteps.get(host).length));
  }
  for(const c of columns) if(c.keep) c.tree = keepTree(c.keep);
  let rowCount = model ? model.recordCount : null;
  const warnings = [];
  if(explodeSteps && model){
    const node = nodeAt(model, opts.explode);
    rowCount = node ? node.seen : 0;
    if(!node) warnings.push({kind:"plan", detail:"explode path not found in this file: " + opts.explode});
  }
  return {columns:columns, explodeSteps:explodeSteps, explodeUnpack:explodeUnpack,
          rowCount:rowCount, warnings:warnings};
}

/* --- transforms --- */

function collectLeaves(v, path, acc){
  if(Array.isArray(v)){ acc.push([path, JSON.stringify(v)]); return; }   // arrays stay opaque (§12)
  if(plain(v)){
    const keys = Object.keys(v);
    if(!keys.length){ acc.push([path, "{}"]); return; }                  // no key ever vanishes
    for(const k of keys) collectLeaves(v[k], path + "." + k, acc);
    return;
  }
  acc.push([path, v]);
}

function flattenRow(row, sink, rowNo){
  const out = {};
  for(const k in row){
    const v = row[k];
    if(v === null || typeof v !== "object"){
      if(has(out, k)){
        sink.warn({kind:"flatten-collision", row:rowNo, path:k,
                   detail:'"' + k + '" collides with a key an earlier expansion already produced — the earlier value is kept'});
        continue;
      }
      out[k] = v;
      continue;
    }
    const leaves = [];
    collectLeaves(v, k, leaves);
    let clash = null;
    for(const l of leaves) if(l[0] !== k && has(out, l[0])) clash = l[0];
    if(clash){
      // Flattening is not injective; rather than let one value overwrite another,
      // the colliding key is left unflattened and warned about (§12).
      out[k] = v;
      sink.warn({kind:"flatten-collision", row:rowNo, path:k,
                 detail:'"' + k + '" not flattened — expanding it would produce "' + clash + '", which already exists'});
      continue;
    }
    for(const l of leaves) out[l[0]] = l[1];
  }
  return out;
}

function alphaIndex(n){                       // 1 → a, 26 → z, 27 → aa (spreadsheet style)
  let s = "";
  while(n > 0){ const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function chunkString(s, cap){
  const out = [];
  let i = 0;
  while(i < s.length){
    let end = Math.min(i + cap, s.length);
    // Never cut between the two halves of a surrogate pair; back off one unit.
    if(end < s.length){
      const c = s.charCodeAt(end - 1);
      if(c >= 0xD800 && c <= 0xDBFF) end--;
    }
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

function splitRow(row, opts, sink, rowNo){
  const cap = opts.splitCap > 0 ? opts.splitCap : 30000;
  const token = (opts.splitToken || "").trim();
  const out = {};
  for(const k in row){
    const v = row[k];
    if(typeof v !== "string" || v.length <= cap){ out[k] = v; continue; }
    const parts = chunkString(v, cap);
    const keys = parts.map(function(_, i){
      return k + (token ? "_" + token : "") + "_" + (opts.splitStyle === "alpha" ? alphaIndex(i + 1) : String(i + 1));
    });
    let clash = null;
    for(const kk of keys) if(has(row, kk) || has(out, kk)) clash = kk;
    if(clash){
      out[k] = v;
      sink.warn({kind:"split-collision", row:rowNo, path:k,
                 detail:'"' + k + '" not split — target key "' + clash + '" already exists'});
      continue;
    }
    for(let i = 0; i < keys.length; i++) out[keys[i]] = parts[i];
  }
  return out;
}

const BREAKS = /\r\n|\n|\r/g;

function stripBreaks(row, mode){
  if(mode === "keep" || !mode) return row;
  const rep = mode === "space" ? " " : mode === "literal" ? "\\n" : "";
  for(const k in row){
    if(typeof row[k] === "string" && BREAKS.test(row[k])){
      BREAKS.lastIndex = 0;
      row[k] = row[k].replace(BREAKS, rep);
    }
    BREAKS.lastIndex = 0;
  }
  return row;
}

function prettyPrint(row, paths){
  for(const p of paths){
    if(!has(row, p) || typeof row[p] !== "string") continue;   // a split chunk never parses, so it is left alone
    try{ row[p] = JSON.stringify(JSON.parse(row[p]), null, 2); }catch(e){}
  }
  return row;
}

// CSV only (W15), at all depths. A big integer nested inside a value that gets
// JSON-serialised into one cell is stringified here; a top-level one is quoted
// by csvCell instead, so the cell stays a number to a JSON reader and a string
// to a spreadsheet. JSONL leaves both as numbers — JSONL consumers read big
// integers fine, and retyping them there would alter the schema for no benefit.
function deepQuoteBigInts(v){
  if(typeof v === "number") return (Number.isInteger(v) && Math.abs(v) > MAX_SAFE) ? String(v) : v;
  if(Array.isArray(v)) return v.map(deepQuoteBigInts);
  if(plain(v)){
    const out = {};
    for(const k in v) if(has(v, k)) out[k] = deepQuoteBigInts(v[k]);
    return out;
  }
  return v;
}

function quoteBigInts(row){
  for(const k in row){
    const v = row[k];
    if(v !== null && typeof v === "object") row[k] = deepQuoteBigInts(v);
  }
  return row;
}

/* --- serialisation --- */

function csvCell(v){
  if(v === undefined || v === null) return "";          // unquoted empty reads as NULL
  // Large-integer quoting, CSV only (W15). Quoting is the protection: unquoted,
  // a 19-digit id still arrives in a spreadsheet as 7.66975E+18.
  if(typeof v === "number" && Number.isInteger(v) && Math.abs(v) > MAX_SAFE) return '"' + v + '"';
  let s;
  if(typeof v === "string") s = v;
  else if(typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if(s === "") return '""';                             // quoted empty reads as the empty string
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRow(row, cols){
  const out = new Array(cols.length);
  for(let i = 0; i < cols.length; i++) out[i] = csvCell(row[cols[i]]);
  return out.join(",");
}

/* --- the pass itself --- */

function buildRow(unit, P){
  const row = {};
  for(const c of P.columns){
    let v;
    if(unit.ctx && c.under){
      if(c.rest.length === 0) v = unit.ctx.key !== null ? unit.ctx.key : unit.ctx.elem;
      else v = project(unit.ctx.elem, c.rest, 0, c.restUnpack);
    } else {
      v = project(unit.rec, c.steps, 0, c.unpackAt);
    }
    // W21. Packaged the moment it is projected, so every later stage — explode,
    // flatten, split, line breaks — sees an ordinary value. An empty keep-list is
    // a container with everything deselected: it emits {} so a CSV header keeps
    // its width between two exports of one file.
    if(v !== undefined && c.keep) v = c.keep.length ? prune(v, c.tree) : {};
    if(v !== undefined) row[c.path] = v;
  }
  return row;
}

function* units(records, P){
  for(let ri = 0; ri < records.length; ri++){
    const rec = records[ri];
    if(!P.explodeSteps){ yield {rec:rec, ctx:null, ri:ri}; continue; }
    for(const e of explodeUnits(rec, P.explodeSteps, P.explodeUnpack)) yield {rec:rec, ctx:e, ri:ri};
  }
}

function transform(row, opts, sink, rowNo){
  if(opts.flatten) row = flattenRow(row, sink, rowNo);
  if(opts.split)   row = splitRow(row, opts, sink, rowNo);
  row = stripBreaks(row, opts.lineBreaks);
  if(opts.pretty && opts.pretty.length) row = prettyPrint(row, opts.pretty);
  if(opts.format === "csv") row = quoteBigInts(row);
  return row;
}

// With flatten or split on, the grid's width is set by the widest record, so the
// CSV header needs one discovery pass. Off, the header is exactly the selection
// and no pass is needed.
function discoverColumns(records, opts, P, sink){
  const seen = [], set = new Set();
  let n = 0;
  for(const u of units(records, P)){
    const row = transform(buildRow(u, P), opts, {warn:function(){}}, n++);
    for(const k in row) if(!set.has(k)){ set.add(k); seen.push(k); }
  }
  return seen;
}

const NULL_SINK = {warn:function(){}, tick:function(){}};

// sink: {warn(w), tick(rows)}. Yields output chunks; the caller assembles them
// into a Blob (never a single string — Blob parts live outside the JS heap).
function* run(records, opts, sink){
  sink = sink || NULL_SINK;
  const P = plan(opts, null);
  const csv = opts.format === "csv";
  // From the plan, not from `selected`: a path packaged into a container (W21) is
  // selected but is not a column of its own.
  let cols = P.columns.map(function(c){ return c.path; });
  if(csv && (opts.flatten || opts.split)) cols = discoverColumns(records, opts, P, sink);

  let order = null;
  if(opts.sortBy){
    // Sorting cannot stream, so it sorts an index: pass one keeps one small tuple
    // per output row, not the row itself. Retaining records (W4) is what makes
    // the second pass a random access rather than a re-parse.
    const sortSteps = readers.parsePath(opts.sortBy);
    const col = P.columns.filter(function(c){ return c.path === opts.sortBy; })[0];
    order = [];
    for(const u of units(records, P)){
      let k;
      if(u.ctx && col && col.under){
        k = col.rest.length === 0 ? (u.ctx.key !== null ? u.ctx.key : u.ctx.elem)
                                  : project(u.ctx.elem, col.rest, 0, col.restUnpack);
      } else {
        k = project(u.rec, sortSteps, 0, col ? col.unpackAt : null);
      }
      if(k !== null && typeof k === "object") k = JSON.stringify(k);
      order.push({k:k, u:u});
    }
    const dir = opts.sortDir === "desc" ? -1 : 1;
    order.sort(function(a, b){
      const x = a.k, y = b.k;
      if(x === undefined || x === null) return y === undefined || y === null ? 0 : 1;   // blanks last, both ways
      if(y === undefined || y === null) return -1;
      if(typeof x === "number" && typeof y === "number") return (x - y) * dir;
      const sx = String(x), sy = String(y);
      return (sx < sy ? -1 : sx > sy ? 1 : 0) * dir;
    });
  }

  if(csv) yield cols.map(csvCell).join(",") + "\n";

  const source = order ? order.map(function(o){ return o.u; }) : units(records, P);
  let n = 0, buf = [];
  for(const u of source){
    const row = transform(buildRow(u, P), opts, sink, n);
    buf.push(csv ? csvRow(row, cols) : JSON.stringify(row));
    n++;
    if(buf.length >= 1000){
      yield buf.join("\n") + "\n";
      buf = [];
      sink.tick(n);
    }
  }
  if(buf.length) yield buf.join("\n") + "\n";
  sink.tick(n);
  return n;
}

// Preview builds rows rather than text, so the table can render cells and the
// literal output line side by side (W18). It calls the same transform chain.
function preview(records, opts, limit, sink){
  const P = plan(opts, null);
  const csv = opts.format === "csv";
  const rows = [], lines = [];
  let cols = [], colSet = new Set();
  let n = 0;
  for(const u of units(records, P)){
    if(n >= limit) break;
    const row = transform(buildRow(u, P), opts, sink || NULL_SINK, n);
    for(const k in row) if(!colSet.has(k)){ colSet.add(k); cols.push(k); }
    rows.push(row);
    n++;
  }
  if(!opts.flatten && !opts.split) cols = P.columns.map(function(c){ return c.path; });
  for(const row of rows) lines.push(csv ? csvRow(row, cols) : JSON.stringify(row));
  return {columns:cols, rows:rows, lines:lines, header: csv ? cols.map(csvCell).join(",") : null};
}

return {run:run, plan:plan, preview:preview, project:project, explodeUnits:explodeUnits,
        csvCell:csvCell, chunkString:chunkString, alphaIndex:alphaIndex};
})();

