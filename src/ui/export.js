/* ---------- export options ---------- */

function collectionPaths(){
  const out = [];
  (function walk(node, path){
    for(const e of node.children){
      const p = DW.childPath(path, e[0]);
      if(e[0] === "[]" || e[0] === "{*}") out.push(p);
      walk(e[1], p);
    }
  })(state.model.root, "");
  return out;
}

function renderExplodeOptions(){
  const sel = $("explodeSel");
  const cur = state.opts.explode;
  sel.innerHTML = "";
  sel.appendChild(new Option("record", ""));
  for(const p of collectionPaths()) sel.appendChild(new Option(p, p));
  sel.value = cur;
  if(sel.value !== cur){ state.opts.explode = ""; sel.value = ""; }
  updateRowCount();
}

function renderSortOptions(){
  const sel = $("sortBy");
  const cur = state.opts.sortBy;
  sel.innerHTML = "";
  sel.appendChild(new Option("none", ""));
  for(const p of selectedInOrder()) sel.appendChild(new Option(p, p));
  sel.value = cur;
  if(sel.value !== cur){ state.opts.sortBy = ""; sel.value = ""; }
}

// Row-count change is announced before export, not discovered after (W5).
function updateRowCount(){
  if(!state.model){ $("rowCount").textContent = ""; return; }
  const P = DW.pipeline.plan(buildOpts(), state.model);
  const recs = state.model.recordCount;
  $("rowCount").textContent = state.opts.explode
    ? num(recs) + " records → " + num(P.rowCount) + " rows"
    : num(recs) + " rows";
}

/* ---------- export ---------- */

function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}

$("exportBtn").addEventListener("click", function(){
  const opts = buildOpts();
  if(!opts.selected.length){ status("expStatus", "err", "Tick at least one path first."); show("expStatus"); return; }
  $("exportBtn").disabled = true;
  show("expProgress");
  $("expFill").style.width = "0%";
  $("expPct").textContent = "";
  $("expPhase").textContent = "Exporting…";
  hide("expStatus");
  opStart("export");
  const t0 = Date.now();
  session.send({c:"export", opts:opts}, function(m){
    if(m.t === "progress"){
      const p = m.total ? Math.min(100, Math.round(m.rows / m.total * 100)) : 0;
      $("expFill").style.width = p + "%";
      $("expPct").textContent = p + "%";
      $("expPhase").textContent = "Exporting… " + num(m.rows) + " rows";
      opProgress(m);
      return;
    }
    $("exportBtn").disabled = false;
    hide("expProgress");
    opFinish();
    if(m.t === "fail"){ status("expStatus", "err", esc(m.msg)); show("expStatus"); return; }
    // Nothing was written and nothing was lost — the records are still loaded.
    if(m.t === "cancelled"){
      status("expStatus", "warn", "Export cancelled — no file written. The scanned file is still loaded.");
      show("expStatus");
      return;
    }
    if(m.t === "blob"){
      const ext = opts.format === "csv" ? ".csv" : ".jsonl";
      download(m.blob, state.label + "_extract" + ext);
      state.warnings = m.warnings || state.warnings;
      renderWarnings();
      status("expStatus", "ok", num(m.rows) + " rows written · " + fmtBytes(m.blob.size) + " · " +
        ((Date.now() - t0) / 1000).toFixed(1) + "s");
      show("expStatus");
    }
  });
});

/* ---------- structural export (D9, D19) with a Selected / All switch (W16) ---------- */

const SCHEMA_TYPE = {str:"string", int:"integer", float:"number", bool:"boolean", null:"null", obj:"object", arr:"array"};

function emitRows(){
  const rows = flatten(state.model);
  if(state.emitScope === "all") return rows;
  return rows.filter(function(r){ return state.selected.has(r.path); });
}

const emitters = {
  bare(){ return emitRows().map(function(r){ return r.path; }).join("\n") + "\n"; },
  tsv(){
    const L = ["path\ttypes\tpresent\tof parent\texample"];
    for(const r of emitRows()){
      L.push([r.path, typeList(r.node).join(", "), r.node.seen, r.parent ? r.parent.seen : r.node.seen,
              state.redact || r.node.preview === null ? "" : r.node.preview.replace(/\s+/g, " ")].join("\t"));
    }
    return L.join("\n") + "\n";
  },
  md(){
    const L = ["| path | types | present | example |", "|------|-------|---------|---------|"];
    for(const r of emitRows()){
      const ex = state.redact || r.node.preview === null ? "" : r.node.preview.replace(/\|/g, "\\|").replace(/\s+/g, " ");
      L.push("| `" + r.path + "` | " + typeList(r.node).join(", ") + " | " + num(r.node.seen) + " | " + ex + " |");
    }
    return L.join("\n") + "\n";
  },
  // Descriptive only (D19): types and nesting. `required` is left empty and
  // `enum` omitted even where enum detection fired — both would turn an
  // observation over a sample into a claim.
  schema(){
    const keep = state.emitScope === "all" ? null : state.selected;
    const build = function(node, path){
      const uniq = [];
      for(const e of node.types){
        const t = SCHEMA_TYPE[e[0]] || "string";
        if(uniq.indexOf(t) < 0) uniq.push(t);
      }
      const out = {};
      if(uniq.length === 1) out.type = uniq[0];
      else if(uniq.length > 1) out.type = uniq;
      const arrChild = node.children.get("[]");
      if(arrChild) out.items = build(arrChild, path + "[]");
      const props = {};
      let any = false;
      for(const e of ordered(node)){
        if(e[0] === "[]") continue;
        const cp = DW.childPath(path, e[0]);
        if(keep && !hasSelectedUnder(cp)) continue;
        props[e[0]] = build(e[1], cp);
        any = true;
      }
      if(any){ out.properties = props; out.required = []; }
      return out;
    };
    const s = build(state.model.root, "");
    s["$schema"] = "https://json-schema.org/draft/2020-12/schema";
    return JSON.stringify(s, null, 2) + "\n";
  }
};

function hasSelectedUnder(prefix){
  for(const p of state.selected) if(p === prefix || p.indexOf(prefix) === 0) return true;
  return false;
}

$("emitCopy").addEventListener("click", function(){
  const text = emitters[state.emitFmt]();
  navigator.clipboard.writeText(text).then(function(){
    $("emitCopy").textContent = "Copied";
    setTimeout(function(){ $("emitCopy").textContent = "Copy"; }, 1400);
  }).catch(function(){
    $("emitCopy").textContent = "Copy failed";
    setTimeout(function(){ $("emitCopy").textContent = "Copy"; }, 1400);
  });
});
$("emitDl").addEventListener("click", function(){
  const ext = {bare:".paths.txt", tsv:".paths.tsv", md:".paths.md", schema:".schema.json"}[state.emitFmt];
  download(new Blob([emitters[state.emitFmt]()], {type:"text/plain"}), state.label + ext);
});

