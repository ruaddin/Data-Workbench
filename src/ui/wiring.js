/* ---------- tabs and toolbar wiring ---------- */

function paintTabs(){
  $("tabTree").setAttribute("aria-selected", state.tab === "tree");
  $("tabFlat").setAttribute("aria-selected", state.tab === "flat");
  $("tabStats").setAttribute("aria-selected", state.tab === "stats");
  $("treeView").classList.toggle("hidden", state.tab !== "tree");
  $("flatView").classList.toggle("hidden", state.tab !== "flat");
  $("statsView").classList.toggle("hidden", state.tab !== "stats");
  $("treeTools").classList.toggle("hidden", state.tab === "flat");
  $("flatTools").classList.toggle("hidden", state.tab !== "flat");
  $("treeHead").classList.toggle("hidden", state.tab !== "tree");
}
function paintSideTabs(){
  $("tabPreview").setAttribute("aria-selected", state.sideTab === "preview");
  $("tabDetail").setAttribute("aria-selected", state.sideTab === "detail");
  $("previewView").classList.toggle("hidden", state.sideTab !== "preview");
  $("detailView").classList.toggle("hidden", state.sideTab !== "detail");
}

$("tabTree").addEventListener("click", function(){ state.tab = "tree"; paintTabs(); render(); });
$("tabFlat").addEventListener("click", function(){ state.tab = "flat"; paintTabs(); render(); });
$("tabStats").addEventListener("click", function(){ state.tab = "stats"; paintTabs(); render(); });
$("tabPreview").addEventListener("click", function(){ state.sideTab = "preview"; paintSideTabs(); });
$("tabDetail").addEventListener("click", function(){ state.sideTab = "detail"; paintSideTabs(); renderDetail(); });

$("sortSel").addEventListener("change", function(e){ state.sort = e.target.value; render(); });
$("absolute").addEventListener("change", function(e){ state.absolute = e.target.checked; render(); });
$("redact").addEventListener("change", function(e){
  state.redact = e.target.checked; render(); renderDetail(); paintCaseRedact();
});
$("clearSel").addEventListener("click", function(){
  state.selected = new Set();
  state.selectionOrder = [];
  afterSelectionChange();
});
$("expandAll").addEventListener("click", function(){
  const n = countPaths(state.model.root);
  if(n > EXPAND_WARN && !confirm("This tree has " + num(n) + " nodes. Expand all of them?")) return;
  (function walk(node, path){
    state.expanded.add(path);
    for(const e of node.children) walk(e[1], DW.childPath(path, e[0]));
  })(state.model.root, "");
  renderTree();
});
$("collapseAll").addEventListener("click", function(){ state.expanded = new Set([""]); renderTree(); });
$("flatSearch").addEventListener("input", function(e){ state.flatQuery = e.target.value; renderFlat(); });
$("emitFmt").addEventListener("change", function(e){ state.emitFmt = e.target.value; });
$("emitScope").addEventListener("change", function(e){ state.emitScope = e.target.value; });

function paintSplitEnabled(){
  const on = state.opts.split;
  ["splitCap","splitStyle","splitToken"].forEach(function(id){ $(id).disabled = !on; });
}

$("outFmt").addEventListener("change", function(e){ state.opts.format = e.target.value; renderPreview(); });
$("explodeSel").addEventListener("change", function(e){ state.opts.explode = e.target.value; renderPreview(); });
$("lineBreaks").addEventListener("change", function(e){ state.opts.lineBreaks = e.target.value; renderPreview(); });
$("sortBy").addEventListener("change", function(e){ state.opts.sortBy = e.target.value; renderPreview(); });
$("sortDir").addEventListener("change", function(e){ state.opts.sortDir = e.target.value; renderPreview(); });
$("optFlatten").addEventListener("change", function(e){ state.opts.flatten = e.target.checked; renderPreview(); });
$("optSplit").addEventListener("change", function(e){
  state.opts.split = e.target.checked;
  paintSplitEnabled();
  renderPreview();
});
["splitCap","splitToken","splitStyle"].forEach(function(id){
  $(id).addEventListener("input", renderPreview);
  $(id).addEventListener("change", renderPreview);
});

// A changed record path or threshold invalidates the model — the accumulator
// drops enum sets and collapses maps mid-scan, so neither can be recomputed.
["recordPath","enumMax","mapMax"].forEach(function(id){
  $(id).addEventListener("change", function(){
    if(state.model){ status("status", "warn", "Settings changed — press Scan to rebuild the skeleton."); show("status"); }
  });
});

document.addEventListener("keydown", function(e){
  if(e.key === "Escape"){
    document.querySelectorAll("dialog[open]").forEach(function(d){ d.close(); });
  }
});

paintTabs();
paintSideTabs();
paintSplitEnabled();
paintViewBtn();
renderDetail();
doRenderPreview();
