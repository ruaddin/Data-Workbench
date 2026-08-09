/* ---------- selection — one Set<path>, two renderings (W16) ---------- */

// Ticking a parent is a shortcut for its leaf descendants, never a stored state.
// {*} is the exception: it is tickable as *the key*, which is data (W19).
function leavesOf(node, path){
  if(node.key === "{*}") return [path];
  if(node.children.size === 0) return path === "" ? [] : [path];
  let out = [];
  for(const e of node.children) out = out.concat(leavesOf(e[1], DW.childPath(path, e[0])));
  return out;
}

// W21. Whether a node can package its subtree into one column at all. `{*}` and
// `[]` are excluded: `{*}` already projects whole (W19), and `[]` is not tickable.
function canPackage(node){
  return node.children.size > 0 && node.key !== "{*}" && node.key !== "[]";
}

// A container inside another packaged container is already nested in that one's
// JSON, so its own toggle would do nothing. The outer wins; the inner reports why.
function packagedBy(path){
  let host = null;
  for(const w of state.whole){
    if(w === path) continue;
    if(DW.underPath(path, w) && (host === null || w.length > host.length)) host = w;
  }
  return host;
}

function selState(node, path){
  // In one-column mode the checkbox stops being a roll-up: it *is* the column's
  // on/off switch, which is the only thing that makes an empty {} removable (W21).
  if(state.whole.has(path)) return state.selected.has(path) ? "all" : "none";
  const leaves = leavesOf(node, path);
  if(!leaves.length) return "none";
  let on = 0;
  for(const l of leaves) if(state.selected.has(l)) on++;
  return on === 0 ? "none" : on === leaves.length ? "all" : "some";
}

function selectPaths(paths, on){
  for(const p of paths){
    if(on){
      if(!state.selected.has(p)){ state.selected.add(p); state.selectionOrder.push(p); }
    } else {
      state.selected.delete(p);
      const i = state.selectionOrder.indexOf(p);
      if(i >= 0) state.selectionOrder.splice(i, 1);
    }
  }
  afterSelectionChange();
}

function selectedInOrder(){
  return state.selectionOrder.filter(function(p){ return state.selected.has(p); });
}

// The one place the two meanings of a container checkbox are resolved (W21).
function tickNode(node, path, on){
  if(state.whole.has(path)){
    // Unticking a packaged container removes the column outright rather than
    // leaving a {} nobody can get rid of, so the toggle goes with it.
    if(!on) state.whole.delete(path);
    selectPaths(on ? [path] : [path].concat(leavesOf(node, path)), on);
    return;
  }
  selectPaths(leavesOf(node, path), on);
}

// Flipping "keep whole" on: the container becomes the column, and whatever was
// already ticked beneath it becomes the keep-list — all of it, if none was.
function setWhole(node, path, on){
  if(on){
    state.whole.add(path);
    const leaves = leavesOf(node, path);
    let any = false;
    for(const l of leaves) if(state.selected.has(l)){ any = true; break; }
    selectPaths(any ? [path] : [path].concat(leaves), true);
  } else {
    state.whole.delete(path);
    selectPaths([path], false);
  }
}

function afterSelectionChange(){
  render();
  renderSortOptions();
  renderPreview();
  updateSelCount();
}

function updateSelCount(){
  const total = state.model ? countPaths(state.model.root) : 0;
  $("selCount").textContent = num(state.selected.size) + " / " + num(total) + " selected";
}

/* ---------- shared traversal ---------- */

function ordered(node){
  const arr = [];
  for(const e of node.children) arr.push(e);
  if(state.sort === "alpha") arr.sort(function(a, b){ return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  else if(state.sort === "presence") arr.sort(function(a, b){ return b[1].seen - a[1].seen; });
  return arr;
}

function fmtNum(n){
  if(n === null) return "";
  if(Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

// Presence is derived, never stored: relative to the parent by default (D5).
function presence(node, parent){
  if(state.absolute || !parent) return node.seen / (state.model.recordCount || 1);
  return parent.seen ? node.seen / parent.seen : 0;
}

function typeList(node){
  const out = [];
  for(const e of node.types) out.push(e[0] + " ×" + num(e[1]));
  return out;
}

// W22, views only. On a single-typed node the count restates the presence bar beside
// it, so it is dropped; on a split node the count is the whole point, so it stays.
// The emits, Stats and the detail pane keep `typeList` — they are read, not scanned.
function typeBadges(node){
  const out = [];
  const one = node.types.size === 1;
  for(const e of node.types) out.push(one ? e[0] : e[0] + " ×" + num(e[1]));
  return out;
}

function isEmbedded(node){
  return (node.inferred.get("json") || 0) + (node.inferred.get("json?") || 0) > 0 &&
         (node.types.get("str") || 0) > 0;
}

// W22. What used to be one ragged `·`-joined string is split at the source into the
// two cells that carry it, so neither has to be parsed back out of the other.

// "How big is this thing" — one polymorphic answer per node kind. A mixed-type node
// is the only case that still joins, and the cell ellipsises with a title.
function sizeText(node){
  const bits = [];
  if(node.strLenMin !== null) bits.push("len " + num(node.strLenMin) + "–" + num(node.strLenMax));
  if(node.numMin !== null) bits.push("num " + fmtNum(node.numMin) + "–" + fmtNum(node.numMax));
  if(node.arrCount){
    bits.push("elems " + node.arrLenMin + "–" + node.arrLenMax + " avg " + (node.arrLenSum / node.arrCount).toFixed(1) +
      (node.emptyArrays ? " · " + num(node.emptyArrays) + " empty" : ""));
  }
  if(node.isMap) bits.push(num(node.childKeyCount) + " keys" +
    (!state.redact && node.sampleKeys.length ? " e.g. " + node.sampleKeys.slice(0, 3).join(", ") : ""));
  return bits.join("  ·  ");
}

// Enum set when the node has one, else the first value seen. Redact empties it (W20).
function exampleText(node){
  if(state.redact) return "";
  if(node.distinct && node.distinct.size){
    const vals = [];
    for(const v of node.distinct) vals.push(v);
    return "∈ " + vals.join(" | ");
  }
  return node.preview === null ? "" : JSON.stringify(node.preview);
}

