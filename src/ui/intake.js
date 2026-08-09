/* ---------- intake ---------- */

const drop = $("drop"), fileInput = $("file"), paste = $("paste");

const FORCED = {
  jsonl:{format:"jsonl"},              json:{format:"json"},
  csv:{format:"csv", delimiter:","},   tsv:{format:"csv", delimiter:"\t"},
  scsv:{format:"csv", delimiter:";"},  pcsv:{format:"csv", delimiter:"|"},
  xml:{format:"xml"},                  yaml:{format:"yaml"}
};

function effective(){
  const f = FORCED[$("formatSel").value];
  return f ? Object.assign({confidence:"forced"}, f) : state.detected;
}

function renderDetected(){
  const d = state.detected;
  if(!d){ $("detected").textContent = ""; return; }
  const forced = FORCED[$("formatSel").value];
  $("detected").textContent = "detected: " + DW.detect.label(d) + " (" + d.confidence + " confidence)" +
    (forced ? " · reading as " + DW.detect.label(effective()) : "");
}

async function sniffSource(){
  const src = state.source;
  if(src === null || src === ""){ state.detected = null; renderDetected(); return; }
  const sample = typeof src === "string" ? src.slice(0, 65536) : await src.slice(0, 65536).text();
  state.detected = DW.detect.sniff(sample);
  renderDetected();
}

async function pickFile(f){
  // A residue file repaired externally is dropped back onto the same page, not
  // loaded as a new dataset: Workbench matches on record index + path (W10).
  if(state.model && f.size < 64 * 1024 * 1024 && /\.jsonl?$/i.test(f.name)){
    const head = await f.slice(0, 65536).text();
    const path = looksLikeResidue(head);
    if(path){
      const text = await f.text();
      const fixed = [];
      for(const line of text.split("\n")){
        if(line.trim() === "") continue;
        try{ fixed.push(JSON.parse(line)); }catch(e){}
      }
      if(confirm("This looks like a residue file for “" + path + "” (" + fixed.length +
                 " values). Merge the repaired values back into the loaded file?")){
        fileInput.value = "";
        applyFixed(path, fixed);
        return;
      }
    }
  }
  state.source = f;
  state.label = f.name.replace(/\.[^.]+$/, "") || "workbench";
  state.size = f.size;
  $("fileName").textContent = f.name;
  $("fileMeta").textContent = fmtBytes(f.size);
  show("fileChip");
  paste.value = "";
  hide("fatal");
  await sniffSource();
  $("run").disabled = false;
  sizeAdvice();
}

function pickPaste(text){
  state.source = text;
  state.label = "pasted";
  state.size = text.length;
  hide("fileChip");
  fileInput.value = "";
  hide("fatal");
  sniffSource();
  $("run").disabled = text.trim() === "";
}

// The streaming / whole-document asymmetry is a hard ceiling here, not a
// performance note, because records are retained so they can be exported (W3).
function sizeAdvice(){
  const eff = effective();
  if(!eff || typeof state.source === "string"){ hide("status"); return; }
  const whole = !!WHOLE_DOC[eff.format];
  if(whole && state.size > WHOLE_CAP){
    status("status", "err",
      esc(DW.detect.label(eff)) + " has no streaming parser, so a " + fmtBytes(state.size) +
      " file needs roughly " + fmtBytes(state.size * 2.5) + " of memory to parse. Whole-document formats are capped at " +
      fmtBytes(WHOLE_CAP) + ".<br>Tip: convert to JSONL first — JSONL streams to 500 MB.");
    show("status");
    $("run").disabled = true;
    return;
  }
  $("run").disabled = state.source === null;
  if(whole && state.size > WHOLE_WARN){
    status("status", "warn", "Whole-document parse of " + fmtBytes(state.size) +
      " — expect 2–3× that in memory. JSONL and CSV stream instead.");
    show("status");
  } else if(!whole && state.size > LINE_WARN){
    status("status", "warn", fmtBytes(state.size) +
      " is past the comfortable range. Records with many short keys expand 5–8× in memory; long-string records only 1.5–2×.");
    show("status");
  } else hide("status");
}

drop.addEventListener("click", function(){ fileInput.click(); });
drop.addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", function(e){ if(e.target.files[0]) pickFile(e.target.files[0]); });
["dragenter","dragover"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("is-over"); });
});
["dragleave","drop"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("is-over"); });
});
drop.addEventListener("drop", function(e){ const f = e.dataTransfer.files[0]; if(f) pickFile(f); });

// A file can be dropped from anywhere once the zone has scrolled away.
let dragDepth = 0;
window.addEventListener("dragenter", function(e){
  if(!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
  dragDepth++; show("dropOverlay");
});
window.addEventListener("dragleave", function(){ if(--dragDepth <= 0){ dragDepth = 0; hide("dropOverlay"); } });
window.addEventListener("dragover", function(e){ e.preventDefault(); });
window.addEventListener("drop", function(e){
  e.preventDefault(); dragDepth = 0; hide("dropOverlay");
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if(f) pickFile(f);
});

paste.addEventListener("input", function(){ if(paste.value !== "") pickPaste(paste.value); });
$("clearFile").addEventListener("click", function(){
  state.source = null; state.size = 0; state.detected = null;
  fileInput.value = ""; hide("fileChip"); hide("status");
  $("run").disabled = true; renderDetected();
});
$("formatSel").addEventListener("change", function(){ renderDetected(); sizeAdvice(); });

