/* ---------- scan ---------- */

function intOr(id, dflt){
  const v = parseInt($(id).value, 10);
  return (isFinite(v) && v > 0) ? v : dflt;
}

function run(){
  if(state.scanning || state.source === null) return;
  const eff = effective();
  if(!eff){ status("status", "err", "Nothing to scan."); show("status"); return; }
  const isBlob = typeof state.source !== "string";
  if(WHOLE_DOC[eff.format] && isBlob && state.size > WHOLE_CAP){ sizeAdvice(); return; }

  state.scanning = true;
  state.provisional = true;
  state.model = null;
  state.slice = [];
  state.warnings = [];
  state.unpacked = new Set();
  state.unpackInfo = new Map();
  state.pretty = new Set();
  state.whole = new Set();
  state.estimates = new Map();
  state.viewerIndex = 0;               // W29 — position is per file
  state.viewerCase = null;
  hide("fatal"); hide("status"); hide("warnPanel");
  $("run").disabled = true;
  opStart("scan");
  show("progress");
  $("fill").style.width = "0%";
  $("pctLabel").textContent = "";
  $("phase").textContent = WHOLE_DOC[eff.format] ? "Parsing whole document…" : "Scanning…";
  setControlsDisabled(true);

  const t0 = Date.now();
  session.send({
    c:"scan", source:state.source, format:eff.format, delimiter:eff.delimiter,
    recordPath:$("recordPath").value, enumMax:intOr("enumMax", 12), mapMax:intOr("mapMax", 50),
    total: isBlob ? state.size : state.source.length
  }, function(m){
    if(m.t === "progress"){
      const total = m.total || 0;
      if(total){
        const p = Math.min(100, Math.round(m.bytes / total * 100));
        $("fill").style.width = p + "%";
        $("pctLabel").textContent = p + "%";
      }
      $("phase").textContent = "Scanning… " + num(m.records) + " records" +
        (m.errCount ? " · " + num(m.errCount) + " failed" : "");
      opProgress(m);
      return;
    }
    if(m.t === "slice"){ state.slice = m.records; renderPreview(); return; }
    if(m.t === "partial"){
      // Selection is live while this refines (W13); the tree just gains rows.
      state.model = m.model;
      state.provisional = true;
      showResults();
      return;
    }
    // Everything below ends the scan, so the operation bar goes first.
    opFinish();
    if(m.t === "done"){ state.scanning = false; finishScan(); report(m, Date.now() - t0); return; }
    if(m.t === "cancelled"){ state.scanning = false; finishScan(); status("status","warn","Cancelled."); show("status"); return; }
    if(m.t === "fail"){
      state.scanning = false; finishScan();
      $("fatal").innerHTML = "<strong>Scan failed.</strong> " + esc(m.msg);
      show("fatal");
    }
  });
}

function finishScan(){
  $("run").disabled = state.source === null;
  hide("progress");
  setControlsDisabled(false);
}

function setControlsDisabled(on){
  ["formatSel","recordPath","enumMax","mapMax","exportBtn","saveRecipe","loadRecipe"].forEach(function(id){
    const e = $(id); if(e) e.disabled = on;
  });
}

function report(res, ms){
  state.model = res.model;
  state.stats = res;
  state.provisional = false;
  state.warnings = res.warnings || [];

  if(res.records === 0){
    const why = res.errCount ? "The document failed to parse."
              : (res.misses ? "The record path matched nothing." : "No records found.");
    const first = state.warnings.filter(function(w){ return w.kind === "parse"; })[0];
    $("fatal").innerHTML = "<strong>" + esc(why) + "</strong>" + (first ? "<pre>" + esc(first.detail) + "</pre>" : "");
    show("fatal");
    hide("workspace"); hide("exportPanel"); hide("summaryStrip");
    renderWarnings();
    return;
  }

  status("status", "ok", "Scanned <strong>" + num(res.records) + "</strong> records · " +
    num(countPaths(res.model.root)) + " paths · " + (ms / 1000).toFixed(1) + "s" +
    (res.errCount ? " · <strong>" + num(res.errCount) + "</strong> lines failed to parse" : ""));
  show("status");

  if(res.misses) state.warnings.push({kind:"miss", detail:num(res.misses) + " records the record path missed"});

  state.expanded = new Set();
  seedExpanded(res.model.root, "", 0);
  showResults();
  renderWarnings();
}

function seedExpanded(node, path, depth){
  if(depth >= 3) return;                       // top 3 levels expanded (D14)
  state.expanded.add(path);
  for(const e of node.children) seedExpanded(e[1], DW.childPath(path, e[0]), depth + 1);
}

function countPaths(node){
  let n = 0;
  for(const e of node.children) n += 1 + countPaths(e[1]);
  return n;
}

$("run").addEventListener("click", run);

