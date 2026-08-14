/* ---------- the operation bar (W27) ----------

   One Cancel, in one fixed place, present whenever any operation is in flight.
   The old one lived in the intake panel and appeared only during a scan — which
   is not where you are standing when an unpack is running, and is scrolled off
   the screen by the time an export starts.

   Progress here is a live count, never a percentage. Unpack's cost is spread
   across four orders of magnitude — in the reference file, values range from 6 to
   200,000 characters and one value cost 1,000× the median — so a bar built on
   record position would sit at 71% for seconds and read as a hang, which is the
   exact failure it exists to prevent. Scan and export keep their percentage bars,
   where the unit really is uniform: bytes read, and rows written.               */

const OP_LABEL = {scan:"Scanning", unpack:"Repairing", merge:"Merging",
                  residue:"Collecting residue", export:"Exporting", estimate:"Estimating"};

function opStart(op, text){
  state.op = op;
  $("opText").textContent = text || (OP_LABEL[op] || "Working") + "…";
  show("opBar");
  paintViewBtn();          // W29 — a case fetch queued behind an export is not fast
}

function opEnd(){
  state.op = null;
  hide("opBar");
  paintViewBtn();
}

// The three tallies are the ones already reported when an unpack finishes — shown
// while you wait instead of only afterwards.
function opProgress(m){
  if(!state.op) return;
  const op = m.op || state.op;
  if(op === "scan"){
    opSay("Scanning… " + num(m.records) + " records" +
          (m.errCount ? " · " + num(m.errCount) + " failed" : ""));
    return;
  }
  if(op === "export"){ opSay("Exporting… " + num(m.rows) + " rows"); return; }
  if(op === "estimate"){
    opSay("Estimating… " + num(m.done) + (m.total ? " of " + num(m.total) : "") + " values");
    return;
  }
  opSay((OP_LABEL[op] || "Working") + "… " + num(m.done) +
        (m.total ? " of " + num(m.total) : "") +
        " · " + num(m.parsed) + " clean · " + num(m.repaired) + " repaired · " +
        num(m.residue) + " residue");
}

function opSay(text){ $("opText").textContent = text; }

$("opCancel").addEventListener("click", function(){
  if(!state.op) return;
  opSay("Cancelling…");
  $("opCancel").disabled = true;
  session.cancel();
  // A scan is cancelled by terminating the Worker, which cannot then answer. The
  // rest are cancelled by message and report back themselves.
  if(state.op === "scan"){
    state.scanning = false;
    finishScan();
    status("status", "warn", "Cancelled.");
    show("status");
    opFinish();
  }
});

function opFinish(){
  $("opCancel").disabled = false;
  opEnd();
}
