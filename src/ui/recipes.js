/* ---------- recipes (W14) — files, never browser storage ---------- */

function recipe(){
  return {
    tool:"data-workbench", version:1,
    selected:selectedInOrder(), unpacked:Array.from(state.unpacked), pretty:Array.from(state.pretty),
    whole:Array.from(state.whole),
    explode:state.opts.explode, flatten:state.opts.flatten, split:state.opts.split,
    splitCap:intOr("splitCap", 30000), splitStyle:$("splitStyle").value, splitToken:$("splitToken").value,
    lineBreaks:state.opts.lineBreaks, sortBy:state.opts.sortBy, sortDir:state.opts.sortDir,
    format:state.opts.format, redact:state.redact,
    recordPath:$("recordPath").value, mapMax:intOr("mapMax", 50), enumMax:intOr("enumMax", 12)
  };
}

$("saveRecipe").addEventListener("click", function(){
  download(new Blob([JSON.stringify(recipe(), null, 2)], {type:"application/json"}),
           state.label + ".recipe.json");
});
$("loadRecipe").addEventListener("click", function(){ $("recipeFile").click(); });
$("recipeFile").addEventListener("change", async function(e){
  const f = e.target.files[0];
  if(!f) return;
  let r;
  try{ r = JSON.parse(await f.text()); }
  catch(err){ status("expStatus", "err", "That file is not valid JSON."); show("expStatus"); return; }
  if(!r || r.tool !== "data-workbench"){ status("expStatus", "err", "That is not a Data Workbench recipe."); show("expStatus"); return; }
  $("recipeFile").value = "";
  reconcileRecipe(r, f.name);
});

// Loading applies to the currently loaded file and reconciles by path, reporting
// honestly rather than failing silently.
function reconcileRecipe(r, name){
  const all = new Set(flatten(state.model).map(function(x){ return x.path; }));
  const matched = (r.selected || []).filter(function(p){ return all.has(p); });
  const missing = (r.selected || []).filter(function(p){ return !all.has(p); });
  const extra = Array.from(all).filter(function(p){ return state.selected.has(p) && matched.indexOf(p) < 0; });

  const body = $("recipeBody");
  body.innerHTML = "";
  $("recipeLede").textContent = "Loading " + name + " onto " + (state.label || "this file") + ":";
  const line = function(sym, text, cls){
    const d = el("div");
    d.style.cssText = "font-size:12px;margin-bottom:4px;color:var(--" + (cls || "text-2") + ")";
    d.textContent = sym + " " + text;
    body.appendChild(d);
    return d;
  };
  line("✓", matched.length + " of " + (r.selected || []).length + " paths matched", "green");
  if(missing.length){
    line("⚠", missing.length + " not present in this file:", "red");
    const pre = el("div", "val", missing.join("\n"));
    body.appendChild(pre);
  }
  if(extra.length) line("✓", extra.length + " paths currently selected are not in the recipe", "text-3");

  const dlg = $("recipeDlg");
  const apply = function(){
    state.selected = new Set(matched);
    state.selectionOrder = matched.slice();
    state.unpacked = new Set();
    state.pretty = new Set((r.pretty || []).filter(function(p){ return all.has(p); }));
    // A packaged container only packages while it is itself selected (W21), so a
    // recipe naming one whose path this file lacks reconciles away with the rest.
    state.whole = new Set((r.whole || []).filter(function(p){ return all.has(p); }));
    state.redact = !!r.redact;
    $("redact").checked = state.redact;
    state.opts.explode = all.has(r.explode) ? r.explode : "";
    state.opts.flatten = !!r.flatten;   $("optFlatten").checked = state.opts.flatten;
    state.opts.split = !!r.split;       $("optSplit").checked = state.opts.split;
    $("splitCap").value = r.splitCap || 30000;
    $("splitStyle").value = r.splitStyle || "num";
    $("splitToken").value = r.splitToken || "";
    paintSplitEnabled();
    state.opts.lineBreaks = r.lineBreaks || "keep";  $("lineBreaks").value = state.opts.lineBreaks;
    state.opts.format = r.format || "jsonl";          $("outFmt").value = state.opts.format;
    state.opts.sortDir = r.sortDir || "asc";          $("sortDir").value = state.opts.sortDir;
    renderExplodeOptions();
    $("explodeSel").value = state.opts.explode;
    renderSortOptions();
    state.opts.sortBy = matched.indexOf(r.sortBy) >= 0 ? r.sortBy : "";
    $("sortBy").value = state.opts.sortBy;
    // Unpack toggles are re-run, not restored: a graft has to be rebuilt from the data.
    for(const p of (r.unpacked || [])) if(all.has(p)) doUnpack(p);
    afterSelectionChange();
    dlg.close();
  };
  $("recipeApply").onclick = apply;
  $("recipeCancel").onclick = function(){ dlg.close(); };
  dlg.showModal();
}

