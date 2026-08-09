
const $ = function(id){ return document.getElementById(id); };

/* Driven inside the worker, appended to a copy of dw-core's own source text.
   Keep it free of ${ } so it survives as a template literal. */
const WORKER_SHIM = `
self.onmessage = async function(e){
  var d = e.data;
  try{
    if(d.c === "cancel"){ DW.engine.cancel(); return; }
    if(d.c === "scan"){
      var res = await DW.engine.scan(d.source, d.format, d, function(m){ m.total = d.total; self.postMessage(m); });
      if(res){ res.t = "done"; self.postMessage(res); }
      else self.postMessage({t:"cancelled"});
      return;
    }
    if(d.c === "unpack"){ self.postMessage(DW.engine.unpack(d.path)); return; }
    if(d.c === "residue"){ self.postMessage(DW.engine.residue(d.path)); return; }
    if(d.c === "merge"){ self.postMessage(DW.engine.merge(d.path, d.fixed)); return; }
    if(d.c === "export"){
      self.postMessage(DW.engine.exportData(d.opts, function(m){ self.postMessage(m); }));
      return;
    }
  }catch(err){
    self.postMessage({t:"fail", msg:(err && err.message) ? err.message : String(err)});
  }
};
`;

const WHOLE_DOC = {json:true, yaml:true, xml:true};
const WHOLE_WARN = 100 * 1024 * 1024;
const WHOLE_CAP  = 200 * 1024 * 1024;
const LINE_WARN  = 250 * 1024 * 1024;
const EXPAND_WARN = 5000;
const PREVIEW_ROWS = 200;
const PREVIEW_COLS = 60;   // columns *rendered* as a table; the rest are named below it
const CELL_CAP = 200;
const RESIDUE_INLINE = 50;

/* ---------- state — the main thread owns the intent, the Worker owns the data ---------- */

const state = {
  source:null, label:"workbench", size:0, detected:null,
  model:null, stats:null, provisional:false, scanning:false,
  slice:[], warnings:[],
  selected:new Set(), selectionOrder:[], unpacked:new Set(), pretty:new Set(), whole:new Set(),
  unpackInfo:new Map(),
  tab:"tree", sideTab:"preview", detailPath:null,
  sort:"doc", absolute:false, redact:false, expanded:new Set(),
  emitFmt:"bare", emitScope:"selected", flatQuery:"",
  residue:{path:null, items:[]},
  opts:{format:"jsonl", explode:"", flatten:false, split:false, splitCap:30000,
        splitStyle:"num", splitToken:"", lineBreaks:"keep", sortBy:"", sortDir:"asc"}
};

