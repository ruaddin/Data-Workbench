
const $ = function(id){ return document.getElementById(id); };

/* Driven inside the worker, appended to a copy of dw-core's own source text.
   Keep it free of ${ } so it survives as a template literal.

   Every long command awaits (W27). That is what makes `{c:'cancel'}` deliverable:
   postMessage *out* of a busy Worker queues fine, but an incoming message cannot
   run while a synchronous loop holds the event loop, so the handler would never
   see it. The engine yields; this handler stays out of the way. */
const WORKER_SHIM = `
self.onmessage = async function(e){
  var d = e.data;
  var emit = function(m){ m.id = d.id; self.postMessage(m); };
  try{
    if(d.c === "cancel"){ DW.engine.cancel(); return; }
    if(d.c === "scan"){
      var res = await DW.engine.scan(d.source, d.format, d, function(m){ m.total = d.total; emit(m); });
      if(res){ res.t = "done"; emit(res); }
      else emit({t:"cancelled"});
      return;
    }
    if(d.c === "unpack"){ emit(await DW.engine.unpack(d.path, emit)); return; }
    if(d.c === "residue"){ emit(await DW.engine.residue(d.path, emit)); return; }
    if(d.c === "merge"){ emit(await DW.engine.merge(d.path, d.fixed, emit)); return; }
    if(d.c === "export"){ emit(await DW.engine.exportData(d.opts, emit)); return; }
    if(d.c === "estimate"){ emit(await DW.engine.estimate(d.path, emit)); return; }
    if(d.c === "case"){ emit(DW.engine.caseAt(d.i, d.opts)); return; }
  }catch(err){
    emit({t:"fail", msg:(err && err.message) ? err.message : String(err)});
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

/* W29 · the case viewer. Preview's CELL_CAP is right for a grid and wrong here —
   reading the long value *is* this screen's job — but `fix.js` is written against
   200 KB values and unbounded rendering drops them into the DOM whole. The window
   counts characters, not bytes: the same unit as the fixer's budget and the size
   column, so no new unit enters the tool. */
const VIEW_WINDOW = 20000;
const VIEW_ROWS = 200;      // table rows before `show all`
const VIEW_DEPTH = 3;       // recursion depth before a container becomes a chip

/* ---------- state — the main thread owns the intent, the Worker owns the data ---------- */

const state = {
  source:null, label:"workbench", size:0, detected:null,
  model:null, stats:null, provisional:false, scanning:false,
  slice:[], warnings:[],
  selected:new Set(), selectionOrder:[], unpacked:new Set(), pretty:new Set(), whole:new Set(),
  unpackInfo:new Map(),
  estimates:new Map(),       // path → W28 estimate, or the string "running"
  op:null,                   // the operation in flight, if any (W27)
  tab:"tree", sideTab:"preview", detailPath:null,
  // W29 · the case viewer. Path-keyed state persists across navigation; case-keyed
  // state does not. Only the path-keyed half is here — section collapse and the
  // markdown choice, both of which mean the same thing on every record. Cell
  // expansion, a display repair and a widened value window are case-keyed and live
  // in the DOM, which navigation rebuilds; that is the rule expressed structurally
  // rather than as a map somebody has to remember to clear.
  viewer:false, viewerIndex:0, viewerCase:null,
  viewerCollapsed:new Set(), viewerMd:new Set(),
  sort:"doc", absolute:false, redact:false, expanded:new Set(),
  emitFmt:"bare", emitScope:"selected", flatQuery:"",
  residue:{path:null, items:[]},
  opts:{format:"jsonl", explode:"", flatten:false, split:false, splitCap:30000,
        splitStyle:"num", splitToken:"", lineBreaks:"keep", sortBy:"", sortDir:"asc"}
};

