/* ==========================================================================
   DW.session — the Worker command loop, with a main-thread fallback.
   Blob-URL workers are blocked from an opaque file:// origin in some browsers,
   and whole-document formats need DOMParser / js-yaml, which the Worker has not
   got. Both cases run the identical core here instead; the fallback is
   materially weaker because the records then sit on the main thread, and the UI
   says so.
   ========================================================================== */

const session = (function(){
  let worker = null, url = null, pending = null, lastMsg = null, heard = false, seq = 0;
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
      // The same awaits as the Worker shim. Here they buy a responsive UI rather
      // than a deliverable message — the loops are on the main thread, so without
      // them the page would lock for the whole operation (W27).
      if(msg.c === "unpack"){ cb(await DW.engine.unpack(msg.path, cb)); return; }
      if(msg.c === "residue"){ cb(await DW.engine.residue(msg.path, cb)); return; }
      if(msg.c === "merge"){ cb(await DW.engine.merge(msg.path, msg.fixed, cb)); return; }
      if(msg.c === "export"){ cb(await DW.engine.exportData(msg.opts, cb)); return; }
      if(msg.c === "estimate"){ cb(await DW.engine.estimate(msg.path, cb)); return; }
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
    //
    // Every command also carries a sequence number the Worker stamps onto each
    // reply, and a reply for a superseded command is dropped. Until v1.3.0 there
    // was one `pending` callback and nothing checked whose reply it was, which was
    // safe only because every command was started by a click. The W28 estimate is
    // not — it fires when a detail pane opens — so a late reply from it could
    // otherwise land in the handler for whatever the user started next.
    send(msg, cb){
      const id = ++seq;
      // An estimate starts on its own when a detail pane opens, so it can still be
      // running when the user clicks Unpack or Export. Get it out of the Worker's
      // way rather than making the click queue behind it. Harmless if it already
      // finished: every command clears the cancel flag as it starts.
      if(lastMsg && lastMsg.c === "estimate"){
        DW.engine.cancel();
        if(worker) worker.postMessage({c:"cancel"});
      }
      msg.id = id;
      lastMsg = msg;
      pending = function(m){ if(m.id !== undefined && m.id !== id) return; cb(m); };
      const stamp = function(m){ if(m.id === undefined) m.id = id; pending(m); };
      if(msg.c === "scan") dataOnMain = !!WHOLE_DOC[msg.format] || typeof msg.source === "string";
      if(local || dataOnMain){ runLocal(msg, stamp); return; }
      const w = ensure();
      if(!w){ runLocal(msg, stamp); return; }
      w.postMessage(msg);
    },

    // Cancel cannot mean one action (W27). `terminate()` is right for a scan,
    // where nothing is loaded yet and destroying the Worker costs nothing. It is
    // catastrophic for an unpack or an export, where it would destroy the records
    // and force a re-scan of the whole file. Everything else is cancelled by
    // message, which the Worker can now receive because its loops yield.
    //
    // Invariant: cancelling never discards loaded records.
    cancel(){
      DW.engine.cancel();               // the local path, and the shim's own engine
      const running = lastMsg && lastMsg.c;
      if(running === "scan" || !running){
        if(worker){ worker.terminate(); worker = null; heard = false;
                    if(url){ URL.revokeObjectURL(url); url = null; } }
        return;
      }
      if(worker) worker.postMessage({c:"cancel"});
    }
  };
})();

