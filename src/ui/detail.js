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

function emptyBlock(h, p){
  const e = el("div", "empty");
  e.appendChild(el("div", "h", h));
  e.appendChild(el("div", "p", p));
  return e;
}

