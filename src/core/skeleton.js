/* ---------- DW.skeleton (D3, D5, D10–D16 + W11 statistics) ---------- */

function newNode(key){
  return {
    key:key, seen:0, bytes:0, types:new Map(), inferred:new Map(), triage:new Map(),
    strLenMin:null, strLenMax:null, numMin:null, numMax:null, preview:null,
    distinct:new Set(), vals:new Map(), valsOver:false,
    lens:new Array(LEN_EDGES.length).fill(0),
    children:new Map(),                       // insertion order == first-seen order (D15)
    childKeyCount:0, isMap:false, sampleKeys:[], unpacked:false,
    arrLenMin:null, arrLenMax:null, arrLenSum:0, arrCount:0, emptyArrays:0
  };
}

/* Characters classified before triage (W28) stops looking. `infer.of` already
   calls JSON.parse on every string opening `{` or `[`; classification adds one
   `validate` walk to the ones that fail, on a value already in hand. On an
   ordinary file that is noise. On a file where a broken path appears in every one
   of two million records it is tens of seconds, added to the loop W13 promises
   will show a tree inside a second — so it is capped, and past the cap the scan
   keeps counting failures but stops classifying them. Degrade, don't grow: the
   same shape as W26's memo cap. */
const TRIAGE_CAP = 50000000;

function skeleton(opts){
  const enumMax = opts && opts.enumMax > 0 ? opts.enumMax : 12;
  const mapMax  = opts && opts.mapMax  > 0 ? opts.mapMax  : 50;
  const root = newNode("(root)");
  let recordCount = 0;
  let triageChars = 0;

  function childOf(node, key){
    let c = node.children.get(key);
    if(!c){ c = newNode(key); node.children.set(key, c); }
    return c;
  }

  function addValue(node, s){
    if(node.distinct !== null){
      node.distinct.add(s.length > DISTINCT_CAP ? s.slice(0, DISTINCT_CAP) + "…" : s);
      if(node.distinct.size > enumMax) node.distinct = null;   // unrecoverable by design
    }
    const key = s.length > DISTINCT_CAP ? s.slice(0, DISTINCT_CAP) + "…" : s;
    if(node.vals.has(key)) node.vals.set(key, node.vals.get(key) + 1);
    else if(node.vals.size < VAL_CAP) node.vals.set(key, 1);
    else node.valsOver = true;
  }

  function noteSample(node, k){
    if(node.sampleKeys.length < SAMPLE_KEYS && node.sampleKeys.indexOf(k) < 0) node.sampleKeys.push(k);
  }

  // Retroactive map collapse (D12): fold the per-key children built so far into a
  // single {*}, merging their subtrees. Buffering keys until the threshold is
  // decided instead would be unbounded on exactly the input this rule exists for.
  function collapseToMap(node){
    node.isMap = true;
    const star = newNode("{*}");
    let occurrences = 0;
    for(const entry of node.children){
      noteSample(node, entry[0]);
      occurrences += entry[1].seen;
      mergeNode(star, entry[1]);
    }
    node.childKeyCount += occurrences;
    node.children = new Map([["{*}", star]]);
  }

  function mergeNode(dst, src){
    dst.seen += src.seen;
    dst.bytes += src.bytes;
    for(const e of src.types) bump(dst.types, e[0], e[1]);
    for(const e of src.inferred) bump(dst.inferred, e[0], e[1]);
    for(const e of src.triage) bump(dst.triage, e[0], e[1]);
    dst.strLenMin = minN(dst.strLenMin, src.strLenMin);
    dst.strLenMax = maxN(dst.strLenMax, src.strLenMax);
    dst.numMin = minN(dst.numMin, src.numMin);
    dst.numMax = maxN(dst.numMax, src.numMax);
    if(dst.preview === null) dst.preview = src.preview;
    for(let i = 0; i < dst.lens.length; i++) dst.lens[i] += src.lens[i];
    if(dst.distinct === null || src.distinct === null) dst.distinct = null;
    else {
      for(const v of src.distinct){
        dst.distinct.add(v);
        if(dst.distinct.size > enumMax){ dst.distinct = null; break; }
      }
    }
    if(src.valsOver) dst.valsOver = true;
    for(const e of src.vals){
      if(dst.vals.has(e[0])) dst.vals.set(e[0], dst.vals.get(e[0]) + e[1]);
      else if(dst.vals.size < VAL_CAP) dst.vals.set(e[0], e[1]);
      else dst.valsOver = true;
    }
    dst.arrCount += src.arrCount;
    dst.arrLenSum += src.arrLenSum;
    dst.arrLenMin = minN(dst.arrLenMin, src.arrLenMin);
    dst.arrLenMax = maxN(dst.arrLenMax, src.arrLenMax);
    dst.emptyArrays += src.emptyArrays;
    dst.childKeyCount += src.childKeyCount;
    if(src.isMap) dst.isMap = true;
    for(const k of src.sampleKeys) noteSample(dst, k);

    for(const e of src.children){
      const k = e[0], sc = e[1];
      if(dst.isMap && k !== "{*}"){ mergeNode(childOf(dst, "{*}"), sc); continue; }
      const dc = dst.children.get(k);
      if(dc) mergeNode(dc, sc);
      else dst.children.set(k, sc);
    }
    // Folding many sibling subtrees together can itself cross the threshold.
    if(!dst.isMap && dst.children.size > mapMax) collapseToMap(dst);
  }

  function visit(node, value){
    node.seen++;
    const t = typeOf(value);
    bump(node.types, t);

    if(t === "str"){
      const len = value.length;
      node.bytes += len;
      node.lens[lenBucket(len)]++;
      node.strLenMin = minN(node.strLenMin, len);
      node.strLenMax = maxN(node.strLenMax, len);
      if(node.preview === null) node.preview = value.slice(0, PREVIEW);
      const inf = infer.of(value);
      if(inf) bump(node.inferred, inf);
      // W28. `infer.of` has just established this value opens like JSON and does
      // not parse; classifying it is one `validate` walk over text already in
      // hand. The verdict says whether Unpack has anything to work with here —
      // `refused` is text no repair can invent back, `undetermined` is the
      // fixer's to decide, and most of those repair.
      if(inf === "json?"){
        if(triageChars + value.length > TRIAGE_CAP) bump(node.triage, "unclassified");
        else {
          triageChars += value.length;
          const t = fix.triageTrimmed(value.trim());
          bump(node.triage, t.verdict === "refused" ? t.cause : t.verdict);
        }
      }
      addValue(node, value);
      return;
    }
    if(t === "int" || t === "float"){
      const s = String(value);
      node.bytes += s.length;
      node.numMin = minN(node.numMin, value);
      node.numMax = maxN(node.numMax, value);
      if(node.preview === null) node.preview = s;
      addValue(node, s);
      return;
    }
    if(t === "bool" || t === "null"){
      const s = String(value);
      node.bytes += s.length;
      if(node.preview === null) node.preview = s;
      addValue(node, s);
      return;
    }
    if(t === "arr"){
      const len = value.length;
      node.arrCount++;
      node.arrLenSum += len;
      node.arrLenMin = minN(node.arrLenMin, len);
      node.arrLenMax = maxN(node.arrLenMax, len);
      if(len === 0){ node.emptyArrays++; return; }
      // Every element, not just [0] (D13). All indices share one node, whose
      // `seen` becomes the element count — the array denominator for D5.
      const star = childOf(node, "[]");
      for(const el of value) visit(star, el);
      return;
    }
    if(t === "obj"){
      for(const k in value){
        if(!has(value, k)) continue;
        if(!node.isMap && !node.children.has(k) && node.children.size >= mapMax) collapseToMap(node);
        if(node.isMap){
          node.childKeyCount++;
          noteSample(node, k);
          visit(childOf(node, "{*}"), value[k]);
        } else {
          visit(childOf(node, k), value[k]);
        }
      }
    }
  }

  function depthOf(node){
    let d = 0;
    for(const e of node.children){ const c = depthOf(e[1]) + 1; if(c > d) d = c; }
    return d;
  }

  return {
    add(record){ recordCount++; visit(root, record); },
    root: root,
    // A snapshot is the live tree: Map and Set are structured-cloneable, so the
    // progressive `partial` message (W13) costs one clone of a ~150-node tree.
    snapshot(){ return {root:root, recordCount:recordCount, depth:depthOf(root),
                        enumMax:enumMax, mapMax:mapMax, provisional:true}; },
    finish(){ return {root:root, recordCount:recordCount, depth:depthOf(root),
                      enumMax:enumMax, mapMax:mapMax, provisional:false}; },
    depthOf: depthOf
  };
}

/* ---------- path helpers, shared by the model, selection and the pipeline ---------- */

function childPath(path, key){
  if(key === "[]") return path + "[]";
  const seg = String(key).replace(/[\\.[\]]/g, "\\$&");
  return path ? path + "." + seg : seg;
}

// Strict descendant test on *steps*, not strings — "a.bc" must not read as a child
// of "a.b" (W21).
function underPath(path, ancestor){
  const a = readers.parsePath(ancestor), p = readers.parsePath(path);
  if(a.length >= p.length) return false;
  for(let i = 0; i < a.length; i++) if(a[i] !== p[i]) return false;
  return true;
}

function nodeAt(model, path){
  if(path === "") return model.root;
  let node = model.root;
  for(const s of readers.parsePath(path)){
    node = node.children.get(s);
    if(!node) return null;
  }
  return node;
}

// Every reference to a value at `path` inside one record, as {o, k} pairs so the
// value can be both read and written (the residue merge writes).
function refsAt(v, steps, i, out){
  const s = steps[i], last = i === steps.length - 1;
  if(s === "[]"){
    if(!Array.isArray(v)) return;
    for(let k = 0; k < v.length; k++){
      if(last) out.push({o:v, k:k}); else refsAt(v[k], steps, i+1, out);
    }
    return;
  }
  if(s === "{*}"){
    if(!plain(v)) return;
    for(const k in v){
      if(!has(v, k)) continue;
      if(last) out.push({o:v, k:k}); else refsAt(v[k], steps, i+1, out);
    }
    return;
  }
  if(!plain(v) || !has(v, s)) return;
  if(last) out.push({o:v, k:s}); else refsAt(v[s], steps, i+1, out);
}

function valueRefs(record, steps){
  const out = [];
  if(steps.length) refsAt(record, steps, 0, out);
  return out;
}

