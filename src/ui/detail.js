/* ---------- path detail pane (W11: one path in depth) ---------- */

function openDetail(path){
  state.detailPath = path;
  state.sideTab = "detail";
  paintSideTabs();
  renderDetail();
}

function renderDetail(){
  const host = $("detailView");
  host.innerHTML = "";
  const path = state.detailPath;
  if(!path || !state.model){
    host.appendChild(emptyBlock("No path selected", "Click any row in the Tree or Flat view to inspect it here."));
    return;
  }
  const node = DW.nodeAt(state.model, path);
  if(!node){ host.appendChild(emptyBlock("Path not found", path)); return; }

  const head = el("div", "section");
  const t = el("div");
  t.style.cssText = "font-family:var(--font-mono);font-size:13px;word-break:break-all;margin-bottom:8px";
  t.textContent = path;
  head.appendChild(t);
  const badges = el("div");
  badges.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
  for(const b of typeList(node)) badges.appendChild(el("span", "badge", b));
  for(const e of node.inferred) badges.appendChild(el("span", "badge inf", "→ " + e[0] + " ×" + num(e[1])));
  head.appendChild(badges);
  host.appendChild(head);

  const triage = triageSection(node, path);
  if(triage) host.appendChild(triage);

  const handling = handlingSection(node, path);
  if(handling) host.appendChild(handling);

  const stats = el("div", "section");
  const grid = el("div", "stats");
  const tile = function(n, label, tint){
    const s = el("div", "stat");
    const v = el("div", "num", n);
    if(tint) v.style.color = "var(--" + tint + ")";
    s.appendChild(v);
    s.appendChild(el("div", "label", label));
    grid.appendChild(s);
  };
  const nulls = node.types.get("null") || 0;
  const empties = node.inferred.get("empty") || 0;
  tile(num(node.seen), "occurrences");
  tile(node.seen ? ((nulls / node.seen) * 100).toFixed(1) + "%" : "—", "null", nulls ? "red" : null);
  tile(node.seen ? ((empties / node.seen) * 100).toFixed(1) + "%" : "—", "empty string");
  tile(num(node.bytes), "chars held");
  stats.appendChild(grid);
  host.appendChild(stats);

  if(node.arrCount){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "Array lengths"));
    const dl = el("dl", "kv");
    const put = function(k, v){ dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); };
    put("arrays", num(node.arrCount));
    put("min / max", node.arrLenMin + " / " + node.arrLenMax);
    put("mean", (node.arrLenSum / node.arrCount).toFixed(2));
    put("empty", num(node.emptyArrays));
    s.appendChild(dl);
    host.appendChild(s);
  }

  const totalLens = node.lens.reduce(function(a, b){ return a + b; }, 0);
  if(totalLens){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "String length histogram"));
    const h = el("div", "hist");
    const max = Math.max.apply(null, node.lens);
    for(let i = 0; i < node.lens.length; i++){
      if(!node.lens[i]) continue;
      const lo = DW.LEN_EDGES[i], hi = i + 1 < DW.LEN_EDGES.length ? DW.LEN_EDGES[i+1] - 1 : "∞";
      const r = el("div", "row");
      r.appendChild(el("span", "lab", lo + "–" + hi));
      const bar = el("div", "bar");
      const f = el("span");
      f.style.width = Math.round(node.lens[i] / max * 100) + "%";
      bar.appendChild(f);
      r.appendChild(bar);
      r.appendChild(el("span", "n", num(node.lens[i])));
      h.appendChild(r);
    }
    s.appendChild(h);
    host.appendChild(s);
  }

  if(node.numMin !== null){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "Numeric range"));
    const dl = el("dl", "kv");
    dl.appendChild(el("dt", null, "min")); dl.appendChild(el("dd", null, fmtNum(node.numMin)));
    dl.appendChild(el("dt", null, "max")); dl.appendChild(el("dd", null, fmtNum(node.numMax)));
    s.appendChild(dl);
    host.appendChild(s);
  }

  if(node.isMap){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "Map"));
    const dl = el("dl", "kv");
    dl.appendChild(el("dt", null, "distinct keys")); dl.appendChild(el("dd", null, num(node.childKeyCount)));
    if(!state.redact && node.sampleKeys.length){
      dl.appendChild(el("dt", null, "examples")); dl.appendChild(el("dd", null, node.sampleKeys.join(", ")));
    }
    s.appendChild(dl);
    host.appendChild(s);
  }

  // Redact strips previews, enums, top values and distribution labels from the
  // structural surfaces — this pane among them (W20).
  if(state.redact){
    const s = el("div", "section");
    s.appendChild(el("div", "field-hint", "Values hidden — redact is on. Types, counts and shape remain."));
    host.appendChild(s);
    return;
  }

  if(node.vals.size){
    const s = el("div", "section");
    s.appendChild(el("h3", null, node.distinct && node.distinct.size ? "Enum — every value seen" : "Top values"));
    const list = Array.from(node.vals).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 15);
    const max = list[0][1];
    const h = el("div", "hist");
    for(const v of list){
      const r = el("div", "row");
      const lab = el("span", "lab", v[0]);
      lab.style.width = "40%";
      lab.style.textAlign = "left";
      lab.style.overflow = "hidden";
      lab.style.textOverflow = "ellipsis";
      lab.style.whiteSpace = "nowrap";
      lab.title = v[0];
      lab.setAttribute("dir", "auto");
      r.appendChild(lab);
      const bar = el("div", "bar");
      const f = el("span");
      f.style.width = Math.round(v[1] / max * 100) + "%";
      bar.appendChild(f);
      r.appendChild(bar);
      r.appendChild(el("span", "n", num(v[1])));
      h.appendChild(r);
    }
    s.appendChild(h);
    if(node.valsOver) s.appendChild(el("div", "field-hint", "Tally frozen after " + num(node.vals.size) +
      " distinct values — rarer values are not counted."));
    host.appendChild(s);
  }

  if(node.preview !== null){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "Sample"));
    const v = el("div", "val", node.preview);
    v.setAttribute("dir", "auto");
    s.appendChild(v);
    host.appendChild(s);
  }
}

/* ---------- triage and the unpack estimate (W28) ----------

   The first question anyone has about a file with embedded JSON in it is not
   "which rule fired" — it is *how much work is in here, and is clicking Unpack a
   two-second wait or a four-minute one*. The counts come from classification
   during the scan and are exact; the estimate is a separate, later, opt-in pass,
   because timing needs real `repair` runs and those are the one thing that can
   stall for seconds on a single value.

   The tree row deliberately does not change. `→ embedded JSON ×59` already says
   this path needs attention, which is all a scannable row owes you, and the type
   cell it lives in clips at 130 px. The breakdown is one click away, here.       */

const TRIAGE_LABEL = {
  "truncated":          ["cut off mid-structure",  "upstream; the text is gone"],
  "concatenated-roots": ["two roots concatenated",  "left unchanged by design"],
  "not json":           ["not JSON at all",         "usually a refusal in the field"],
  "undetermined":       ["undetermined",            "the fixer decides; most repair"],
  "unclassified":       ["unclassified",            "classification budget ran out"],
  "empty value":        ["empty",                   ""],
  "not a string":       ["not a string",            ""]
};

// Ordered by what a reader acts on: the hopeless first, then the ones the fixer
// will have a go at.
const TRIAGE_ORDER = ["truncated", "concatenated-roots", "not json", "undetermined",
                      "unclassified", "empty value", "not a string"];

function fmtDuration(ms){
  if(ms < 950) return Math.max(1, Math.round(ms)) + " ms";
  const s = ms / 1000;
  if(s < 90) return s.toFixed(s < 10 ? 1 : 0) + " s";
  const m = s / 60;
  if(m < 90) return m.toFixed(m < 10 ? 1 : 0) + " min";
  return (m / 60).toFixed(1) + " h";
}

function triageSection(node, path){
  const fails = node.inferred.get("json?") || 0;
  if(!fails || !node.triage || !node.triage.size) return null;
  const parsed = node.inferred.get("json") || 0;
  const all = parsed + fails;

  const s = el("div", "section");
  s.appendChild(el("h3", null, "Embedded JSON"));
  s.appendChild(el("div", "field-hint",
    num(fails) + " of " + num(all) + " values do not parse"));

  const list = el("div", "triage");
  for(const k of TRIAGE_ORDER){
    const n = node.triage.get(k);
    if(!n) continue;
    const lab = TRIAGE_LABEL[k] || [k, ""];
    const r = el("div", "triage-row");
    r.appendChild(el("span", "n", num(n)));
    r.appendChild(el("span", "what", lab[0]));
    if(lab[1]) r.appendChild(el("span", "why", "→ " + lab[1]));
    list.appendChild(r);
  }
  s.appendChild(list);
  s.appendChild(estimateBlock(path));
  return s;
}

/* The estimate counts a different population from the breakdown above it, and
   deliberately so. The breakdown is about *embedded JSON*: `infer.of` only calls a
   value that when it opens with `{` or `[`, which is the same population the tree
   row's `→ embedded JSON ×59` counts. Unpack, though, runs the fixer over every
   string at the path, prose included — so the estimate walks all of them, and
   states its own denominator rather than borrowing the one above. */
function estimateBlock(path){
  const box = el("div", "estimate");
  let e = state.estimates.get(path);

  // Nothing runs while the scan is provisional, matching the Unpack button, which
  // already disables itself there.
  if(state.provisional){
    box.appendChild(el("div", "prov", "Unpack estimate — available once the scan finishes."));
    return box;
  }
  // A "running" entry with no estimate in flight is stale: the request was
  // superseded by something the user clicked, and its reply was dropped. Retry
  // rather than showing "estimating…" for the rest of the session.
  if(e === "running" && state.op !== "estimate"){
    state.estimates.delete(path);
    e = undefined;
  }
  if(e === undefined){
    box.appendChild(el("div", "prov", requestEstimate(path) ? "estimating…" : "waiting for the current operation…"));
    return box;
  }
  if(e === "running"){ box.appendChild(el("div", "prov", "estimating…")); return box; }
  // A cancelled estimate stays cancelled. Clearing the entry instead would have the
  // next render start it again, which is not what Cancel meant.
  if(e === "cancelled"){ box.appendChild(el("div", "prov", "Unpack estimate cancelled.")); return box; }
  if(e === null){ box.appendChild(el("div", "prov", "Unpack estimate unavailable.")); return box; }

  // When the sample blows its own budget, that is the answer: `breathe` yields
  // between values and never inside one, so a single huge value can consume the
  // whole box on its own — and that value is precisely the one that dominates the
  // real cost. Report it as a floor and lead with it, rather than smoothing it
  // into a soft average.
  if(e.worst){
    const w = el("div", "prov floor");
    w.textContent = "⚠ one value alone took " + fmtDuration(e.worst.ms) + " to search — record " +
                    num(e.worst.i) + " · " + fmtBytes(e.worst.len);
    box.appendChild(w);
  }
  box.appendChild(el("div", "big",
    "Unpack: " + (e.stopped ? "at least " : "") + "~" + fmtDuration(e.ms)));
  box.appendChild(el("div", "prov", (e.stopped
    ? "sample stopped early — " + num(e.sampled)
    : "estimated from " + num(e.sampled)) + " of " + num(e.total) + " values at this path"));
  return box;
}

// One request per path, cached for the session. It runs in the Worker, where the
// records live and where `scanPath` already runs, so a pathological value delays a
// number and never the UI. Deferred while another operation holds the Worker.
function requestEstimate(path){
  if(state.op) return false;             // the Worker is busy; the next render retries
  state.estimates.set(path, "running");
  opStart("estimate");
  session.send({c:"estimate", path:path}, function(m){
    if(m.t === "progress"){ opProgress(m); return; }
    opFinish();
    if(m.t === "estimate") state.estimates.set(m.path, m);
    else state.estimates.set(path, m.t === "cancelled" ? "cancelled" : null);
    if(state.detailPath === path) renderDetail();
  });
  return true;
}

function emptyBlock(h, p){
  const e = el("div", "empty");
  e.appendChild(el("div", "h", h));
  e.appendChild(el("div", "p", p));
  return e;
}

