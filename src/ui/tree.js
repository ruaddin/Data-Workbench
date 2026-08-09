/* ---------- tree (D16 lazy render, plus checkboxes and unpack toggles) ---------- */

// W25. Every built row registers how to repaint itself against the current
// selection. Tree and Flat share the index — only one of them is ever rendered —
// and whichever renders clears it first.
const rowRepaint = new Map();

function render(){
  updateSelCount();
  renderPrettyNote();
  if(state.tab === "tree") renderTree();
  else if(state.tab === "flat") renderFlat();
  else renderStats();
}

// The selection-only path: no DOM is torn down. Rebuilding a few thousand rows
// per click is what made ticking a checkbox stall.
function repaintSelection(){
  updateSelCount();
  renderPrettyNote();
  if(state.tab === "stats") return;            // stats reads nothing from the selection
  for(const e of rowRepaint) e[1]();
}

function renderTree(){
  const host = $("treeView");
  const keepScroll = $("reportBody").scrollTop;
  invalidateSel();
  rowRepaint.clear();
  host.innerHTML = "";
  const frag = document.createDocumentFragment();
  for(const e of ordered(state.model.root)){
    frag.appendChild(buildNode(e[1], state.model.root, DW.childPath("", e[0]), 1));
  }
  host.appendChild(frag);
  $("reportBody").scrollTop = keepScroll;
}

function buildNode(node, parent, path, depth){
  const wrap = el("div");
  const row = el("div", "trow");
  row.title = path;

  const hasKids = node.children.size > 0;
  const tw = el("button", "tw" + (hasKids ? "" : " leaf"), state.expanded.has(path) ? "▾" : "▸");
  tw.setAttribute("aria-label", hasKids ? "Expand or collapse " + path : "");
  if(!hasKids) tw.tabIndex = -1;
  row.appendChild(tw);

  // [] is not tickable — an array index is rarely worth a column (W19).
  const box = el("input", "box" + (node.key === "[]" ? " off" : ""));
  box.type = "checkbox";
  box.setAttribute("aria-label", "Select " + path);
  if(node.key !== "[]"){
    const st = selState(path);
    box.checked = st === "all";
    box.indeterminate = st === "some";
    box.addEventListener("click", function(e){ e.stopPropagation(); });
    box.addEventListener("change", function(){ tickNode(node, path, box.checked); });
  } else box.disabled = true;
  row.appendChild(box);

  const name = el("span", "tname" + (node.key === "{*}" ? " map" : node.key === "[]" ? " arr" : ""), node.key);
  row.appendChild(name);

  let type = typeCell(node, path);
  row.appendChild(type);

  const size = el("span", "tsize", sizeText(node));
  size.title = size.textContent;
  row.appendChild(size);

  const ex = el("span", "tex", exampleText(node));
  ex.title = ex.textContent;
  ex.setAttribute("dir", "auto");
  row.appendChild(ex);

  // A synthetic node's `seen` counts elements or map values, not occurrences, so
  // seen/parent.seen is a mean rather than a presence.
  if(node.key === "[]" || node.key === "{*}"){
    const c = el("span", "pct", num(node.seen));
    c.title = node.key === "[]" ? "total elements across " + num(parent.arrCount) + " arrays"
                                : "total values across " + num(parent.seen) + " occurrences of this map";
    row.appendChild(el("span", "pbar"));
    row.appendChild(c);
  } else {
    const p = presence(node, parent);
    const bar = el("span", "pbar");
    const fill = el("span");
    fill.style.width = Math.min(100, Math.round(p * 100)) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    const pct = el("span", "pct", (p * 100).toFixed(p < 0.1 && p > 0 ? 1 : 0) + "%");
    pct.title = num(node.seen) + " of " + num(state.absolute ? state.model.recordCount : parent.seen);
    row.appendChild(pct);
  }

  wrap.appendChild(row);

  const kids = el("div", "kids");
  wrap.appendChild(kids);

  let built = false;
  const paint = function(){
    const open = state.expanded.has(path);
    tw.textContent = open ? "▾" : "▸";
    kids.style.display = open ? "" : "none";
    if(open && !built){
      built = true;
      for(const e of ordered(node)) kids.appendChild(buildNode(e[1], node, DW.childPath(path, e[0]), depth + 1));
    }
  };

  if(hasKids){
    tw.addEventListener("click", function(e){
      e.stopPropagation();
      if(state.expanded.has(path)) state.expanded.delete(path); else state.expanded.add(path);
      paint();
    });
  }
  // Clicking the row flips the right pane from Preview to Path detail (W11).
  row.addEventListener("click", function(){ openDetail(path); });
  row.style.cursor = "pointer";

  // The chips only move when *handling* changes, which is rare; comparing them
  // keeps the common case — a tick — down to two property writes per row.
  let chips = stateChips(path).join("");
  rowRepaint.set(path, function(){
    if(node.key !== "[]"){
      const st = selState(path);
      box.checked = st === "all";
      box.indeterminate = st === "some";
    }
    const now = stateChips(path).join("");
    if(now !== chips){
      chips = now;
      const next = typeCell(node, path);
      row.replaceChild(next, type);
      type = next;
    }
  });

  paint();
  return wrap;
}

// W22. A fixed-width cell holding a variable run of badges, so it overflows by
// design. Inferred chips outrank a third literal type: "→ embedded JSON" is what
// marks a path as handleable, where "float ×3" is only trivia.
const TYPE_BADGES = 2;

// W24. Handling lives in the detail pane, so the row has to *say* what is set on a
// path or the state is invisible where you scan. These are readouts, not controls:
// they rank above everything, and the row click that reveals them also opens the
// pane that changes them.
function stateChips(path){
  const out = [];
  if(state.whole.has(path)) out.push("one column");
  if(state.unpacked.has(path)) out.push("unpacked");
  if(state.pretty.has(path)) out.push("pretty");
  return out;
}

function typeCell(node, path){
  const cell = el("span", "ttype");
  const items = [];
  for(const t of typeBadges(node)) items.push({cls:"badge", text:t});
  for(const e of node.inferred){
    items.push({cls:"badge " + (e[0] === "json?" ? "warn" : "inf"), pri:true,
      text: e[0] === "json?" ? "→ embedded JSON ×" + num(e[1]) : "→ " + e[0] + " ×" + num(e[1])});
  }

  // State chips are laid out *first*, ahead of the source-ordered rest. The cell is
  // a fixed 130px that clips, so ranking them only for the keep/`+N` cut would still
  // let `→ embedded JSON ×32` push `unpacked` past the right edge — invisible in the
  // one case it exists for (W24).
  const chips = stateChips(path);
  for(const s of chips) cell.appendChild(el("span", "badge set", s));

  const shown = items.filter(function(i){ return i.pri; }).concat(items.filter(function(i){ return !i.pri; }));
  const keep = shown.slice(0, Math.max(1, TYPE_BADGES - chips.length)), rest = shown.slice(keep.length);
  // Restore source order among the kept ones so types still read before inferences.
  for(const i of items) if(keep.indexOf(i) >= 0) cell.appendChild(el("span", i.cls, i.text));
  if(rest.length){
    const more = el("span", "badge more", "+" + rest.length);
    more.title = rest.map(function(i){ return i.text; }).join("\n");
    cell.appendChild(more);
  }
  cell.title = chips.concat(items.map(function(i){ return i.text; })).join("  ·  ");
  return cell;
}

