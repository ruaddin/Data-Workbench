/* ==========================================================================
   DW.session — the Worker command loop, with a main-thread fallback.
   Blob-URL workers are blocked from an opaque file:// origin in some browsers,
   and whole-document formats need DOMParser / js-yaml, which the Worker has not
   got. Both cases run the identical core here instead; the fallback is
   materially weaker because the records then sit on the main thread, and the UI
   says so.
   ========================================================================== */

const session = (function(){
  let worker = null, url = null, pending = null, lastMsg = null, heard = false;
  let local = false;        // no Worker available at all — file:// blob restriction
  let dataOnMain = false;   // this dataset's records live on the main thread

  function makeWorker(){
    const core = document.getElementById("dw-core").textContent;
    const blob = new Blob([core, WORKER_SHIM], {type:"text/javascript"});
    url = URL.createObjectURL(blob);
    return new Worker(url);
  }

  function goLocal(reason){
    local = true;
    if(worker){ worker.terminate(); worker = null; }
    if(url){ URL.revokeObjectURL(url); url = null; }
    if(reason){
      $("noWorker").innerHTML =
        "<strong>Running without a Web Worker</strong> (blocked by this browser on <code>file://</code>). " +
        "Large files will be slower and the size limit is lower — records have to sit on the main thread. " +
        "Serving over <code>http://</code> or GitHub Pages restores full speed.";
      show("noWorker");
    }
  }

  async function runLocal(msg, cb){
    try{
      if(msg.c === "scan"){
        DW.engine.state.cancelled = false;
        const res = await DW.engine.scan(msg.source, msg.format, {
          delimiter:msg.delimiter, recordPath:msg.recordPath, enumMax:msg.enumMax, mapMax:msg.mapMax,
          breathe:function(){ return new Promise(function(r){ setTimeout(r, 0); }); }
        }, function(m){ m.total = msg.total; cb(m); });
        if(res){ res.t = "done"; cb(res); } else cb({t:"cancelled"});
        return;
      }
      if(msg.c === "unpack"){ cb(DW.engine.unpack(msg.path)); return; }
      if(msg.c === "residue"){ cb(DW.engine.residue(msg.path)); return; }
      if(msg.c === "merge"){ cb(DW.engine.merge(msg.path, msg.fixed)); return; }
      if(msg.c === "export"){ cb(DW.engine.exportData(msg.opts, cb)); return; }
    }catch(err){ cb({t:"fail", msg:(err && err.message) ? err.message : String(err)}); }
  }

  function ensure(){
    if(worker) return worker;
    let w = null;
    try{ w = makeWorker(); }catch(e){ w = null; }
    if(!w){ goLocal("blocked"); return null; }
    heard = false;
    w.onmessage = function(e){ heard = true; if(pending) pending(e.data); };
    w.onerror = function(e){
      e.preventDefault && e.preventDefault();
      if(!heard){ goLocal("blocked"); const m = lastMsg, cb = pending; if(m) runLocal(m, cb); }
      else if(pending) pending({t:"fail", msg:e.message || "worker error"});
    };
    worker = w;
    return w;
  }

  return {
    get isLocal(){ return local; },

    // Whole-document formats and pasted text never reach the Worker: the readers
    // need DOMParser and js-yaml, which it has not got. Every later command for
    // that dataset follows its records to the main thread — and the next scan of
    // a line-oriented file gets the Worker back.
    send(msg, cb){
      pending = cb;
      lastMsg = msg;
      if(msg.c === "scan") dataOnMain = !!WHOLE_DOC[msg.format] || typeof msg.source === "string";
      if(local || dataOnMain){ runLocal(msg, cb); return; }
      const w = ensure();
      if(!w){ runLocal(msg, cb); return; }
      w.postMessage(msg);
    },

    cancel(){
      DW.engine.cancel();
      if(worker){ worker.terminate(); worker = null; heard = false;
                  if(url){ URL.revokeObjectURL(url); url = null; } }
    }
  };
})();

