/* ==========================================================================
   DW case viewer (W29) — one record at a time, every selected path, full length.

   Every other surface answers a question about the *file*: the strip how big, the
   Stats tab which paths differ, the detail pane what is at this path, Preview what
   the export will write. None answers *what does this one record contain?*
   Preview comes closest and cannot get there — it is a grid capped at 200
   characters a cell, which is the right shape for "is my export right" and the
   wrong shape for reading a 4 KB model output.

   Three rules hold this file together:

   - **The viewer renders `buildRow` and stops.** No transform runs. Flatten, split,
     line-break stripping, pretty-print and big-int quoting are export shaping and
     Preview's subject. With flatten on there is no embedded object left to draw a
     table from, which is the feature that prompted the screen.
   - **Sections come from the selection, not from the record.** `buildRow` omits
     absent paths, so rendering from the row would move the section you are reading
     up and down the page as you page through the file. Fixed order makes `›` a
     flip-book.
   - **Nothing here writes.** Not to a record, not to the selection, not to the
     tree. Every interpretation the viewer applies — a parse, a repair, markdown —
     is chipped and reversible, and a section with no chips is showing the value
     verbatim.
   ========================================================================== */

// Everything the main page is made of. The viewer is a screen, not a fourth tab:
// Tree / Flat / Stats are three renderings of the skeleton sharing one row
// grammar, and a record reader is not a fourth one — it would also inherit the
// report pane's width, which is the constraint that makes Preview unable to do
// this job.
const VIEWER_HIDES = ["intakePanel", "summaryStrip", "warnPanel", "workspace", "exportPanel"];

function paintViewBtn(){
  $("viewBtn").disabled = !state.model || state.provisional || !!state.op;
}

function openViewer(){
  // Disabled while an operation is in flight (W27): a case fetch is fast, but
  // queued behind a scan or an export it is not.
  if(!state.model || state.provisional || state.op) return;
  state.viewer = true;
  for(const id of VIEWER_HIDES) hide(id);
  document.querySelector(".page-head").classList.add("hidden");
  show("viewer");
  paintCaseRedact();
  viewerGo(state.viewerIndex, true);
  scrollTo(0, 0);
}

function closeViewer(){
  if(!state.viewer) return;
  state.viewer = false;
  hide("viewer");
  document.querySelector(".page-head").classList.remove("hidden");
  show("intakePanel");
  show("summaryStrip"); show("workspace"); show("exportPanel");
  renderWarnings();                 // shows the panel only if there are warnings
}

// W20 is not relitigated here — the viewer *is* values, so a redacted viewer is an
// empty page with type chips on it. What changed is the size of the consequence:
// the leak surface was a 200-character cell in a side pane and is now a full-width
// page rendering an entire model output. So it says so, where it bites.
function paintCaseRedact(){
  $("caseRedact").classList.toggle("hidden", !state.redact);
}

/* ---------- navigation ----------
   Fetch-on-demand with no prefetch cache: a window of cached neighbours is latency
   optimisation ahead of measurement against a Worker that is idle by construction,
   and it buys an invalidation problem that selection changes, unpacks and rescans
   would each have to remember to clear. Two mechanics make on-demand feel right,
   and both are required — see below. */

let caseTimer = null, caseSeq = 0;

function viewerGo(i, force){
  const total = caseTotal();
  if(!total) return;
  i = Math.max(0, Math.min(total - 1, i));
  if(i === state.viewerIndex && !force) return;
  state.viewerIndex = i;
  state.viewerCase = null;
  // The index moves instantly and the content follows. A nav that waits on data is
  // the actual latency complaint under key-repeat, not the fetch.
  paintCaseNav();
  renderCaseBody();
  // Coalesced, so scrubbing with a held key issues a handful of requests instead of
  // forty. The counter still moves per keypress.
  clearTimeout(caseTimer);
  caseTimer = setTimeout(fetchCase, 50);
}

function caseTotal(){ return state.model ? state.model.recordCount : 0; }

function fetchCase(){
  const seq = ++caseSeq;
  session.send({c:"case", i:state.viewerIndex, opts:buildOpts()}, function(m){
    // Last wins. Without this, three fast presses can land out of order and leave
    // you reading record 8 with the counter saying 10 — the worst failure
    // available, because nothing on screen looks wrong.
    if(seq !== caseSeq) return;
    if(m.t !== "case"){ renderCaseBody(m.msg || "the record could not be read"); return; }
    state.viewerCase = m;
    renderCaseBody();
  });
}

function paintCaseNav(){
  const total = caseTotal();
  $("caseNum").value = String(state.viewerIndex + 1);
  // The word *records* is on screen because with explode on the viewer's case count
  // and the export's row count are different numbers, and the two must never read
  // as one quantity measured twice.
  $("caseTotal").textContent = "/ " + num(total) + " records";
  $("casePrev").disabled = state.viewerIndex <= 0;
  $("caseNext").disabled = state.viewerIndex >= total - 1;
}

/* ---------- the section list ----------
   The columns the export would write, in selection order. Not `state.selected`:
   a path packaged into a container (W21) is selected and is not a column of its
   own, so a section for it would read `absent` on every record. `plan` is pure, so
   computing it here cannot drift from the Worker's copy. */
function caseColumns(){
  return DW.pipeline.plan(buildOpts(), null).columns.map(function(c){ return c.path; });
}

function renderCaseBody(err){
  const host = $("caseBody");
  host.innerHTML = "";
  if(err){ host.appendChild(emptyBlock("Could not read this record", err)); return; }
  const cols = caseColumns();
  if(!cols.length){
    host.appendChild(emptyBlock("No paths selected",
      "Tick paths in the Tree or Flat view. The viewer shows one section per selected path, in the same order the export writes them."));
    return;
  }
  const row = state.viewerCase ? state.viewerCase.row : null;
  const frag = document.createDocumentFragment();
  for(const p of cols) frag.appendChild(caseSection(p, row));
  host.appendChild(frag);
}

function caseSection(path, row){
  const pending = row === null;
  const present = !pending && DW.has(row, path);
  const v = present ? row[path] : undefined;

  const sec = el("div", "csec");
  const head = el("div", "csec-head");
  const collapsed = state.viewerCollapsed.has(path);
  const tw = el("span", "csec-tw", collapsed ? "▸" : "▾");
  head.appendChild(tw);
  const name = el("span", "csec-path", path);
  name.title = path;
  head.appendChild(name);
  const chipHost = el("span", "csec-chips");
  head.appendChild(chipHost);
  head.appendChild(el("span", "grow"));
  const togHost = el("span", "csec-tog");
  head.appendChild(togHost);

  // A separate target from collapse: a header that both toggles a section and
  // leaves the screen is a misclick generator, and the misclick costs your place.
  const jump = el("button", "csec-act csec-jump", "↗");
  jump.title = "Open this path in the detail pane";
  jump.setAttribute("aria-label", "Open " + path + " in the detail pane");
  jump.addEventListener("click", function(e){ e.stopPropagation(); closeViewer(); openDetail(path); });
  head.appendChild(jump);

  head.appendChild(el("span", "csec-state" + (present ? "" : " absent"),
                      pending ? "" : present ? stateText(v) : "absent"));

  const body = el("div", "csec-body");
  let hasBody = false;
  if(pending){
    body.appendChild(el("div", "cnote", "reading…"));
    hasBody = true;
  } else if(present && v !== null && v !== ""){
    buildBody(body, path, v, chipHost, togHost);
    hasBody = true;
  }

  sec.appendChild(head);
  if(hasBody){
    body.classList.toggle("hidden", collapsed);
    sec.appendChild(body);
    head.addEventListener("click", function(){
      const now = !state.viewerCollapsed.has(path);
      if(now) state.viewerCollapsed.add(path); else state.viewerCollapsed.delete(path);
      body.classList.toggle("hidden", now);
      tw.textContent = now ? "▸" : "▾";
    });
    head.style.cursor = "pointer";
  } else {
    head.style.cursor = "default";
  }
  return sec;
}

// The right-hand state. `absent`, `empty` and `null` are deliberately three
// different words: in LLM-pipeline data they mean three different upstream
// failures, and collapsing them would throw that away.
function stateText(v){
  if(v === null) return "null";
  const t = DW.typeOf(v);
  if(t === "str") return v === "" ? "str · empty" : "str · " + num(v.length) + " chars";
  if(t === "arr") return "arr · " + num(v.length) + (v.length === 1 ? " item" : " items");
  if(t === "obj"){
    const k = Object.keys(v).length;
    return "obj · " + num(k) + (k === 1 ? " key" : " keys");
  }
  return t;
}

/* ---------- what earns which rendering ---------- */

// Chips go straight into the live header, not into a list rendered once: a display
// repair rewrites what the section is showing, and the chips are the only thing on
// screen saying so. A header still reading `does not parse` above a clean table
// would be exactly the two-surfaces-disagreeing failure they exist to prevent.
function chip(host, text, kind){
  host.appendChild(el("span", "cchip" + (kind ? " " + kind : ""), text));
}

function buildBody(body, path, v, chipHost, togHost){
  if(typeof v === "string"){ stringBody(body, path, v, chipHost, togHost); return; }
  renderValue(body, v, 1);
}

/* Embedded JSON (D11) arrives here as a *string*: `project` only parses at an
   unpacked path. So the viewer decides how far it will go on its own, and the line
   is drawn where the ambiguity starts.

   `JSON.parse` succeeding is not a judgement call — there is exactly one
   interpretation and no information is invented. Repair *is* a judgement call, so
   it stays behind a button. Only values that open with `{` or `[` are tried at
   all, which is the same population `infer.of` calls embedded JSON; without it a
   field holding `4` would render as a number the file does not contain. */
function stringBody(body, path, v, chipHost, togHost){
  const t = v.trim();
  if(t.length > 1 && (t[0] === "{" || t[0] === "[")){
    let parsed, ok = true;
    try{ parsed = JSON.parse(t); }catch(e){ ok = false; }
    if(ok){
      chip(chipHost, "parsed for display");
      renderValue(body, parsed, 1);
      return;
    }
    // No markdown toggle on a value whose parse failed: markdown would render over
    // the red span and hide the one thing this rendering exists to show. That is
    // not looks-like-markdown sniffing — it is that there is no plain text on
    // screen to offer a second reading of.
    failedJson(body, path, v, chipHost);
    return;
  }
  textBody(body, path, v, togHost);
}

/* ---------- markdown ----------
   Default `raw`, the same position taken throughout: parse only what is
   unambiguous, never repair silently, label the mark *stopped at*. A viewer that
   opens showing `**score**` as bold has made an interpretive choice before being
   asked, and this is a tool for looking at data. One click gets the rendered view,
   and the click is what makes it your reading rather than the tool's claim.

   Sticky per path, because "render `response` as markdown" means the same thing on
   every record. Per section rather than global, because a global switch would
   render `case_id` and `score` as markdown too. On every string section, with no
   looks-like-markdown sniffing. */
function textBody(body, path, v, togHost){
  const on = state.viewerMd.has(path);
  togHost.innerHTML = "";
  const tog = el("span", "md-toggle");
  const mk = function(label, want){
    const b = el("button", null, label);
    b.setAttribute("aria-pressed", String(on === want));
    b.addEventListener("click", function(e){
      e.stopPropagation();
      if(want) state.viewerMd.add(path); else state.viewerMd.delete(path);
      body.innerHTML = "";
      textBody(body, path, v, togHost);
    });
    return b;
  };
  tog.appendChild(mk("raw", false));
  tog.appendChild(mk("md", true));
  togHost.appendChild(tog);

  longValue(body, v, null, on
    ? function(host, slice){ renderMarkdownSafely(host, slice); }
    : paintText);
}

/* Rendering untrusted model output as HTML is how a stray `<img>` in someone's data
   quietly phones home, so two defences ship and neither is sufficient alone:
   this configuration, which strips every request-capable vector, and the page's
   CSP `<meta>`, which makes the guarantee browser-enforced rather than promised.
   The first narrows what is constructed; the second bounds what any escape can do. */
const MD_CLEAN = {
  FORBID_TAGS: ["img", "svg", "video", "audio", "iframe", "embed", "object",
                "source", "track", "link", "style"],
  FORBID_ATTR: ["src", "srcset", "href", "style", "background", "poster"]
};

function renderMarkdownSafely(host, text){
  const d = el("div", "cmd");
  d.innerHTML = DOMPurify.sanitize(marked.parse(text), MD_CLEAN);
  host.appendChild(d);
}

/* ---------- long values ----------
   Preview's 200-character cap is right for a grid and wrong here: reading the long
   value *is* this screen's job. But `fix.js` is written against 200 KB values and
   unbounded rendering drops them into the DOM whole, so values are windowed. When a
   parse failed the window centres on the failure rather than on the start —
   `truncated` causes in particular put the interesting position at the end, and a
   window starting at character 0 would hide the red span behind a button on exactly
   the values you opened to diagnose.

   The expanders are DOM state, not stored state: navigation rebuilds the body, and
   that is the whole of "case-keyed state does not persist". */
function longValue(host, v, span, paint){
  const centre = span ? span[0] : 0;
  let from = 0, to = v.length;
  if(v.length > VIEW_WINDOW){
    from = Math.max(0, Math.min(v.length - VIEW_WINDOW, centre - Math.floor(VIEW_WINDOW / 2)));
    to = Math.min(v.length, from + VIEW_WINDOW);
  }
  const draw = function(){
    host.innerHTML = "";
    if(from > 0){
      const b = el("button", "cmore", "▲ " + num(from) + " characters before");
      b.addEventListener("click", function(){ from = Math.max(0, from - VIEW_WINDOW); draw(); });
      host.appendChild(b);
    }
    paint(host, v.slice(from, to), from, to, span);
    if(to < v.length){
      const b = el("button", "cmore", "▼ " + num(v.length - to) + " characters after");
      b.addEventListener("click", function(){ to = Math.min(v.length, to + VIEW_WINDOW); draw(); });
      host.appendChild(b);
    }
  };
  draw();
}

function paintText(host, slice, from, to, span){
  const pre = el("div", "cval");
  pre.setAttribute("dir", "auto");
  if(!span || span[1] <= from || span[0] >= to){
    pre.textContent = slice;
  } else {
    const a = Math.max(from, span[0]), b = Math.min(to, span[1]);
    pre.appendChild(document.createTextNode(slice.slice(0, a - from)));
    pre.appendChild(el("span", "cmark", slice.slice(a - from, b - from)));
    pre.appendChild(document.createTextNode(slice.slice(b - from)));
  }
  host.appendChild(pre);
}

/* ---------- where parsing stopped ----------
   The mark says where parsing *stopped*, not which character is wrong, and the
   caption says so. In `{{"key": "value"}`, `validate` pushes obj on the first
   brace, moves to state `key`, meets `{`, and returns pos 1 — the *second* brace.
   Deleting either fixes the string; choosing one is a repair hypothesis, not a
   parse fact. A caption reading *stopped at* can never be wrong; one implying
   *this character is bad* would be wrong on exactly the ambiguous values where you
   most need to trust it. */

const WANTED = {value:"a value", key:"a key", colon:"a colon", comma:"a comma or a closing bracket"};

function failCaption(v, info){
  if(info.cause === "truncated"){
    if(info.open >= 0)
      return "✗ parse stopped at the end of the value: " + JSON.stringify(v[info.open]) +
             " opened at char " + num(info.open) + " is never closed";
    return "✗ parse stopped at char " + num(info.pos) + ": this string is never closed — the value is cut off";
  }
  if(info.cause === "concatenated-roots")
    return "✗ parse stopped at char " + num(info.pos) +
           ": a second root value starts here — two JSON documents in one string";
  if(info.cause === "not json")
    return "✗ parse stopped at char " + num(info.pos) + ": not JSON — no object, array or scalar at the root";
  if(info.cause === "unexpected"){
    const tok = v.slice(info.pos, Math.min(info.end, info.pos + 24));
    return "✗ parse stopped at char " + num(info.pos) + ": expected " +
           (WANTED[info.want] || "something else") + ", found " + JSON.stringify(tok);
  }
  // `validate` walked the token stream as valid structure and JSON.parse still
  // refused, which is the raw-control-character / invalid-escape class. There is no
  // offset to point at, and inventing one would be the exact dishonesty above.
  return "✗ does not parse — the structure is well-formed, so the failure is inside a string";
}

function failSpan(v, info){
  if(info.cause === "truncated")
    return info.open >= 0 ? [info.open, info.open + 1] : [info.pos, v.length];
  if(info.cause === "concatenated-roots") return [info.pos, v.length];
  if(info.pos < 0) return null;
  return [info.pos, Math.max(info.pos + 1, info.end)];
}

function failedJson(body, path, v, chipHost){
  // `validate` is one tokenise; `repair` is a bounded search that can cost seconds
  // on one value. The cheap one runs on sight, the dear one stays behind the button.
  const off = v.length - v.trimStart().length;
  const raw = DW.fix.validate(v.trim());
  const info = {cause:raw.cause, want:raw.want,
                pos: raw.pos >= 0 ? raw.pos + off : -1,
                end: raw.end >= 0 ? raw.end + off : -1,
                open: raw.open >= 0 ? raw.open + off : -1};
  paintFailure(body, path, v, info, chipHost, false);
}

function paintFailure(body, path, v, info, chipHost, tried){
  body.innerHTML = "";
  chipHost.innerHTML = "";
  chip(chipHost, "does not parse", "warn");
  if(tried) chip(chipHost, "no repair found", "warn");
  body.appendChild(el("div", "cfail", failCaption(v, info)));
  if(tried) body.appendChild(el("div", "cfail", "The fixer found no reading that parses · " + info.cause));
  const text = el("div");
  body.appendChild(text);
  longValue(text, v, failSpan(v, info), paintText);
  body.appendChild(el("div", "cnote",
    "Where parsing stopped — not necessarily the character to change."));

  const row = el("div", "crow");
  /* Repairs nothing. It runs the fixer on this one value so you can see whether it
     is readable, says which rule fired and what it cost, and leaves the data alone.
     Committing it was refused: it would create a repair state that exists at record
     4,102 of one path and nowhere else — invisible in the tree, absent from the
     residue report, gone on rescan, and unexplainable to anyone reading the export.
     The unit of repair in this tool is a path across all records. */
  if(!tried){
    const rb = el("button", "btn-sm", "Repair for display");
    rb.addEventListener("click", function(){
      rb.disabled = true;
      rb.textContent = "Repairing…";
      // One frame, so the label lands before a search that can take seconds.
      setTimeout(function(){ applyDisplayRepair(body, path, v, chipHost); }, 0);
    });
    row.appendChild(rb);
  }
  row.appendChild(unpackLink(path));
  body.appendChild(row);
}

function applyDisplayRepair(body, path, v, chipHost){
  const r = DW.fix.repair(v);
  if(!r.ok){ paintFailure(body, path, v, r, chipHost, true); return; }
  body.innerHTML = "";
  // The fixer's existing vocabulary — rule name and characters moved — rather than
  // a second one invented here.
  chipHost.innerHTML = "";
  chip(chipHost, "repaired for display · " + (r.rule || "reformatted") + " · " + num(r.changed) + " chars", "ok");
  chip(chipHost, "parsed for display");
  renderValue(body, JSON.parse(r.out), 1);
  body.appendChild(el("div", "cnote",
    "Nothing was written. The record, the export and the tree are unchanged — this repair exists on this screen only."));
  const row = el("div", "crow");
  row.appendChild(unpackLink(path));
  body.appendChild(row);
}

function unpackLink(path){
  const b = el("button", "btn-sm", "Unpack this path →");
  b.title = "Opens the Handling block in the Path detail pane, where the repair applies to every record";
  b.addEventListener("click", function(){ closeViewer(); openDetail(path); });
  return b;
}

/* ---------- structural rendering ----------
   The section value is depth 1. Recursion is capped at three levels: an array of
   objects whose cell holds an object whose value is a list is still readable, and a
   fourth level is not. Below the cap a container becomes a chip that expands in
   place — not truncation, since the chip states what is inside and opens on click,
   so nothing is hidden, only deferred. */

function renderValue(host, v, depth){
  if(v === null || typeof v !== "object"){ host.appendChild(scalarNode(v)); return; }
  if(depth > VIEW_DEPTH){ host.appendChild(deepChip(v)); return; }
  if(Array.isArray(v)) renderArray(host, v, depth);
  else renderObject(host, v, depth);
}

function scalarNode(v){
  if(typeof v === "string" && v.length > VIEW_WINDOW){
    const box = el("div");
    longValue(box, v, null, paintText);
    return box;
  }
  const d = el("div", "cval scalar", v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v));
  d.setAttribute("dir", "auto");
  return d;
}

function deepChip(v){
  const b = el("button", "cdeep", Array.isArray(v)
    ? "[…] " + num(v.length) + (v.length === 1 ? " item" : " items")
    : "{…} " + num(Object.keys(v).length) + (Object.keys(v).length === 1 ? " key" : " keys"));
  b.addEventListener("click", function(){
    const slot = el("div");
    renderValue(slot, v, 1);            // the budget restarts where you opened it
    b.replaceWith(slot);
  });
  return b;
}

function renderArray(host, v, depth){
  if(!v.length){ host.appendChild(el("div", "cnote", "empty array")); return; }
  const objs = v.every(function(e){ return DW.plain(e); });
  if(objs){ host.appendChild(objectTable(v, depth)); return; }
  const arrs = v.every(function(e){ return Array.isArray(e); });
  if(arrs){ host.appendChild(positionalTable(v, depth)); return; }
  const scalars = v.every(function(e){ return e === null || typeof e !== "object"; });
  // A one-column table is chrome around nothing.
  if(scalars){ host.appendChild(inlineList(v)); return; }
  host.appendChild(numberedRows(v, depth));     // mixed: no honest column set exists
}

function renderObject(host, v, depth){
  const keys = Object.keys(v);
  if(!keys.length){ host.appendChild(el("div", "cnote", "empty object")); return; }
  const t = table();
  const tb = el("tbody");
  for(const k of keys){
    const tr = el("tr");
    tr.appendChild(el("td", "key", k));
    const td = el("td");
    renderValue(td, v[k], depth + 1);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  t.table.appendChild(tb);
  host.appendChild(t.wrap);
}

function table(){
  const wrap = el("div", "ctable-wrap");
  const t = el("table", "ctable");
  wrap.appendChild(t);
  return {wrap:wrap, table:t};
}

// Rows are elements, columns the union of keys in first-seen order, ragged cells
// blank. Capped at VIEW_ROWS with `show all` beneath, for the same reason values
// are windowed.
function objectTable(v, depth){
  const cols = [], seen = new Set();
  for(const e of v) for(const k in e) if(DW.has(e, k) && !seen.has(k)){ seen.add(k); cols.push(k); }
  const t = table();
  const hr = el("tr");
  hr.appendChild(el("th", "idx", "#"));
  for(const c of cols) hr.appendChild(el("th", null, c));
  const th = el("thead"); th.appendChild(hr); t.table.appendChild(th);
  const tb = el("tbody");
  t.table.appendChild(tb);
  fillRows(tb, v, cols.length + 1, function(e, i){
    const tr = el("tr");
    tr.appendChild(el("td", "idx", String(i + 1)));
    for(const c of cols){
      const td = el("td");
      if(DW.has(e, c)) renderValue(td, e[c], depth + 1);   // ragged cells stay blank
      tr.appendChild(td);
    }
    return tr;
  });
  return t.wrap;
}

function positionalTable(v, depth){
  let width = 0;
  for(const e of v) if(e.length > width) width = e.length;
  const t = table();
  const hr = el("tr");
  hr.appendChild(el("th", "idx", "#"));
  for(let c = 0; c < width; c++) hr.appendChild(el("th", null, String(c + 1)));
  const th = el("thead"); th.appendChild(hr); t.table.appendChild(th);
  const tb = el("tbody");
  t.table.appendChild(tb);
  fillRows(tb, v, width + 1, function(e, i){
    const tr = el("tr");
    tr.appendChild(el("td", "idx", String(i + 1)));
    for(let c = 0; c < width; c++){
      const td = el("td");
      if(c < e.length) renderValue(td, e[c], depth + 1);
      tr.appendChild(td);
    }
    return tr;
  });
  return t.wrap;
}

function numberedRows(v, depth){
  const t = table();
  const tb = el("tbody");
  t.table.appendChild(tb);
  fillRows(tb, v, 2, function(e, i){
    const tr = el("tr");
    tr.appendChild(el("td", "idx", String(i + 1)));
    const td = el("td");
    renderValue(td, e, depth + 1);
    tr.appendChild(td);
    return tr;
  });
  return t.wrap;
}

function fillRows(tb, v, width, build){
  const cap = v.length > VIEW_ROWS ? VIEW_ROWS : v.length;
  for(let i = 0; i < cap; i++) tb.appendChild(build(v[i], i));
  if(cap === v.length) return;
  const tr = el("tr"), td = el("td");
  td.colSpan = width;
  const b = el("button", "cmore", "show all " + num(v.length) + " rows");
  b.addEventListener("click", function(){
    tr.remove();
    for(let i = cap; i < v.length; i++) tb.appendChild(build(v[i], i));
  });
  td.appendChild(b);
  tr.appendChild(td);
  tb.appendChild(tr);
}

function inlineList(v){
  const d = el("div", "clist");
  for(let i = 0; i < v.length; i++){
    if(i) d.appendChild(el("span", "sep", "·"));
    d.appendChild(document.createTextNode(v[i] === null ? "null"
      : typeof v[i] === "string" ? v[i] : JSON.stringify(v[i])));
  }
  d.setAttribute("dir", "auto");
  return d;
}

/* ---------- wiring ---------- */

$("viewBtn").addEventListener("click", openViewer);
$("caseBack").addEventListener("click", closeViewer);
$("casePrev").addEventListener("click", function(){ viewerGo(state.viewerIndex - 1); });
$("caseNext").addEventListener("click", function(){ viewerGo(state.viewerIndex + 1); });
$("caseNum").addEventListener("change", function(){
  const n = parseInt($("caseNum").value, 10);
  if(isFinite(n)) viewerGo(n - 1, true); else paintCaseNav();
});
$("caseCollapse").addEventListener("click", function(){
  const cols = caseColumns();
  const anyOpen = cols.some(function(p){ return !state.viewerCollapsed.has(p); });
  if(anyOpen) for(const p of cols) state.viewerCollapsed.add(p);
  else state.viewerCollapsed.clear();
  renderCaseBody();
});

document.addEventListener("keydown", function(e){
  if(!state.viewer) return;
  if(document.querySelector("dialog[open]")) return;
  if(e.key === "Escape"){ closeViewer(); return; }
  if(!e.altKey) return;
  if(e.key === "ArrowLeft"){ e.preventDefault(); viewerGo(state.viewerIndex - 1); }
  else if(e.key === "ArrowRight"){ e.preventDefault(); viewerGo(state.viewerIndex + 1); }
});
