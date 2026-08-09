/* ---------- flat view ---------- */

function flatten(model){
  const out = [];
  (function walk(node, parent, path){
    if(path !== "") out.push({path:path, node:node, parent:parent});
    for(const e of ordered(node)) walk(e[1], node, DW.childPath(path, e[0]));
  })(model.root, null, "");
  return out;
}

function renderFlat(){
  const rows = flatten(state.model);
  const q = state.flatQuery.trim().toLowerCase();
  const shown = q ? rows.filter(function(r){ return r.path.toLowerCase().indexOf(q) >= 0; }) : rows;
  $("flatCount").textContent = num(shown.length) + " of " + num(rows.length);

  const host = $("flatView");
  invalidateSel();
  rowRepaint.clear();
  host.innerHTML = "";
  const table = el("table", "table");
  const thead = el("thead");
  const hr = el("tr");
  ["", "path", "type", "size", "present", "of parent", "example"].forEach(function(h, i){
    const th = el("th", i === 4 || i === 5 ? "num" : null, h);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tb = el("tbody");
  for(const r of shown){
    const tr = el("tr");
    const tdc = el("td");
    let box = null;
    if(r.node.key !== "[]"){
      box = el("input");
      box.type = "checkbox";
      box.className = "box";
      box.setAttribute("aria-label", "Select " + r.path);
      const st = selState(r.path);
      box.checked = st === "all";
      box.indeterminate = st === "some";
      box.addEventListener("change", function(){ tickNode(r.node, r.path, box.checked); });
      tdc.appendChild(box);
    }
    tr.appendChild(tdc);
    const tdp = el("td", "path", r.path);
    tdp.title = r.path;
    tr.appendChild(tdp);
    let chips = stateChips(r.path);
    const tdt = el("td", null, typeBadges(r.node).concat(chips).join(", "));
    tr.appendChild(tdt);
    // W25. Same in-place repaint the tree does — the flat table is one row per
    // path, so rebuilding it on every tick was the worse of the two.
    rowRepaint.set(r.path, function(){
      if(box){
        const st = selState(r.path);
        box.checked = st === "all";
        box.indeterminate = st === "some";
      }
      const now = stateChips(r.path);
      if(now.join("") !== chips.join("")){
        chips = now;
        tdt.textContent = typeBadges(r.node).concat(chips).join(", ");
      }
    });
    const tsz = el("td", null, sizeText(r.node));
    tsz.title = tsz.textContent;
    tr.appendChild(tsz);
    tr.appendChild(el("td", "num", num(r.node.seen)));
    tr.appendChild(el("td", "num", r.parent ? num(r.parent.seen) : ""));
    const ex = el("td", "cell", state.redact || r.node.preview === null ? "" : r.node.preview.replace(/\s+/g, " "));
    ex.setAttribute("dir", "auto");
    tr.appendChild(ex);
    tr.addEventListener("click", function(e){ if(e.target.tagName !== "INPUT") openDetail(r.path); });
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  host.appendChild(table);
}

/* ---------- stats tab (W11: comparison across paths) ---------- */

function renderStats(){
  const host = $("statsView");
  rowRepaint.clear();            // the rows those closures held are gone from the DOM
  host.innerHTML = "";
  const rows = flatten(state.model);

  const section = function(title){
    const s = el("div", "section");
    s.appendChild(el("h3", null, title));
    host.appendChild(s);
    return s;
  };
  const table = function(parent, heads, body){
    const wrap = el("div", "table-wrap");
    const t = el("table", "table");
    const hr = el("tr");
    heads.forEach(function(h){ hr.appendChild(el("th", h.num ? "num" : null, h.t)); });
    const th = el("thead"); th.appendChild(hr); t.appendChild(th);
    const tb = el("tbody");
    for(const r of body){
      const tr = el("tr");
      r.forEach(function(c, i){
        const td = el("td", heads[i].num ? "num" : (i === 0 ? "path" : "cell"), c);
        if(i === 0) td.title = c;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    parent.appendChild(wrap);
  };

  // sparsest fields, ranked
  const sparse = rows.filter(function(r){ return r.parent && r.node.key !== "[]" && r.node.key !== "{*}"; })
    .map(function(r){ return {path:r.path, p: r.parent.seen ? r.node.seen / r.parent.seen : 0, seen:r.node.seen, of:r.parent.seen}; })
    .filter(function(r){ return r.p < 1; })
    .sort(function(a, b){ return a.p - b.p; }).slice(0, 25);
  const s1 = section("Sparsest fields — least often present given their parent");
  if(sparse.length) table(s1, [{t:"path"}, {t:"present", num:true}, {t:"of parent", num:true}, {t:"%", num:true}],
    sparse.map(function(r){ return [r.path, num(r.seen), num(r.of), (r.p * 100).toFixed(1) + "%"]; }));
  else s1.appendChild(el("div", "field-hint", "Every path is present in every occurrence of its parent."));

  // type conflicts
  const conflicts = rows.filter(function(r){ return r.node.types.size > 1; }).slice(0, 40);
  const s2 = section("Type conflicts — paths that hold more than one literal type");
  if(conflicts.length) table(s2, [{t:"path"}, {t:"types"}],
    conflicts.map(function(r){ return [r.path, typeList(r.node).join(", ")]; }));
  else s2.appendChild(el("div", "field-hint", "No path holds more than one literal type."));

  // cardinality
  const card = rows.filter(function(r){ return r.node.children.size === 0; })
    .map(function(r){
      return {path:r.path, n: r.node.distinct ? r.node.distinct.size : (r.node.valsOver ? null : r.node.vals.size),
              seen:r.node.seen};
    }).sort(function(a, b){ return (a.n === null ? 1e9 : a.n) - (b.n === null ? 1e9 : b.n); }).slice(0, 30);
  const s3 = section("Cardinality — distinct values per leaf");
  table(s3, [{t:"path"}, {t:"distinct", num:true}, {t:"values", num:true}],
    card.map(function(r){ return [r.path, r.n === null ? "> " + num(state.model.enumMax) : num(r.n), num(r.seen)]; }));

  // heaviest by bytes
  const heavy = rows.slice().sort(function(a, b){ return b.node.bytes - a.node.bytes; })
    .filter(function(r){ return r.node.bytes > 0; }).slice(0, 20);
  const s4 = section("Heaviest fields — characters of value text held at each path");
  table(s4, [{t:"path"}, {t:"chars", num:true}, {t:"avg", num:true}],
    heavy.map(function(r){ return [r.path, num(r.node.bytes), num(Math.round(r.node.bytes / Math.max(1, r.node.seen)))]; }));

  // parse-failure breakdown
  const s5 = section("Parse failures — by message");
  const byMsg = new Map();
  for(const w of state.warnings){
    if(w.kind !== "parse") continue;
    const key = String(w.detail).replace(/\d+/g, "N").slice(0, 90);
    byMsg.set(key, (byMsg.get(key) || 0) + 1);
  }
  if(byMsg.size){
    const list = Array.from(byMsg).sort(function(a, b){ return b[1] - a[1]; });
    table(s5, [{t:"message"}, {t:"lines", num:true}], list.map(function(e){ return [e[0], num(e[1])]; }));
  } else s5.appendChild(el("div", "field-hint", "Every record parsed."));
}

