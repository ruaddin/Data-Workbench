/* ---------- residue (W10) ---------- */

// Why a value was refused, in the words a triage decision actually needs. A flat
// list of thousands of parser messages is unreadable; the split between "cut off"
// and "no reading that parses" is what tells you whether to go back to the
// producing pipeline or to edit by hand.
const CAUSE_LABEL = {
  "truncated":          "cut off mid-structure",
  "concatenated-roots": "two roots concatenated",
  "not json":           "not JSON at all",
  "unexpected":         "no reading that parses",
  "empty value":        "empty",
  "not a string":       "not a string"
};

function causeSummary(causes){
  const rows = Object.keys(causes || {}).map(function(k){ return [k, causes[k]]; });
  if(!rows.length) return "";
  rows.sort(function(a, b){ return b[1] - a[1]; });
  return rows.map(function(r){ return num(r[1]) + " " + (CAUSE_LABEL[r[0]] || r[0]); }).join(" · ");
}

function openResidue(path){
  const info = state.unpackInfo.get(path);
  if(!info) return;
  state.residue = {path:path, items:info.residue};
  const dlg = $("residueDlg");
  const summary = causeSummary(info.causes);
  $("residueLede").textContent = num(info.residue.length) + " value" + (info.residue.length === 1 ? "" : "s") +
    " at " + path + " could not be repaired" + (summary ? " — " + summary + "." : ".") +
    (info.residue.length < RESIDUE_INLINE ? " Edit them below, or download and repair externally."
                                          : " Download them, repair externally, and drop the result back in.");
  const body = $("residueBody");
  body.innerHTML = "";
  if(info.residue.length < RESIDUE_INLINE){
    for(const r of info.residue){
      const item = el("div", "res-item");
      const head = el("div", "head");
      head.appendChild(el("span", null, "record " + r.i + " · #" + r.o));
      head.appendChild(el("span", "why", (CAUSE_LABEL[r.cause] || r.cause || "") + " — " + r.reason));
      item.appendChild(head);
      const ta = el("textarea");
      ta.value = r.raw;
      ta.spellcheck = false;
      ta.setAttribute("aria-label", "Residue value for record " + r.i);
      ta.dataset.i = r.i;
      ta.dataset.o = r.o;
      item.appendChild(ta);
      const note = el("div", "field-hint", "");
      ta.addEventListener("input", function(){
        try{ JSON.parse(ta.value); note.textContent = "✓ parses"; note.style.color = "var(--green)"; }
        catch(e){ note.textContent = e.message; note.style.color = "var(--red)"; }
      });
      item.appendChild(note);
      body.appendChild(item);
    }
    $("residueApply").classList.remove("hidden");
  } else {
    const pre = el("div", "val", info.residue.slice(0, 20).map(function(r){
      return JSON.stringify({i:r.i, o:r.o, path:r.path, cause:r.cause, reason:r.reason,
                             raw:r.raw.length > 120 ? r.raw.slice(0, 120) + "…" : r.raw});
    }).join("\n"));
    body.appendChild(pre);
    $("residueApply").classList.add("hidden");
  }
  dlg.showModal();
}

$("residueClose").addEventListener("click", function(){ $("residueDlg").close(); });
$("residueDl").addEventListener("click", function(){
  const path = state.residue.path;
  session.send({c:"residue", path:path}, function(m){
    if(m.t === "blob") download(m.blob, "residue_" + path.replace(/[^\w.-]+/g, "_") + ".jsonl");
  });
});
$("residueApply").addEventListener("click", function(){
  const fixed = [];
  $("residueBody").querySelectorAll("textarea").forEach(function(ta){
    fixed.push({i:+ta.dataset.i, o:+ta.dataset.o, raw:ta.value});
  });
  applyFixed(state.residue.path, fixed);
  $("residueDlg").close();
});

// Merge on record index + path. The returned values are validated before merge:
// anything that does not parse is counted as missed and left untouched.
function applyFixed(path, fixed){
  session.send({c:"merge", path:path, fixed:fixed}, function(m){
    if(m.t === "fail"){ status("expStatus", "err", esc(m.msg)); show("expStatus"); return; }
    state.model = m.model;
    state.warnings = m.warnings || state.warnings;
    state.unpackInfo.set(path, {total:m.total, parsed:m.parsed, repaired:m.repaired,
                                residue:m.residue, causes:m.causes || {}});
    status("expStatus", "ok", num(m.matched) + " merged" + (m.missed ? " · " + num(m.missed) + " rejected (did not parse)" : "") +
      " · " + num(m.residue.length) + " residue left");
    show("expStatus");
    render(); renderWarnings(); renderPreview();
  });
}

// A residue file repaired externally can be dropped straight back in.
function looksLikeResidue(text){
  const first = text.split("\n").find(function(l){ return l.trim() !== ""; });
  if(!first) return null;
  try{
    const o = JSON.parse(first);
    if(o && typeof o.i === "number" && typeof o.path === "string" && typeof o.raw === "string") return o.path;
  }catch(e){}
  return null;
}

