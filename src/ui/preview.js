/* ---------- preview (W18: a table always, over the first ~200 records) ---------- */

function buildOpts(){
  const o = Object.assign({}, state.opts);
  o.selected = selectedInOrder();
  o.unpacked = Array.from(state.unpacked);
  o.pretty = Array.from(state.pretty);
  o.whole = Array.from(state.whole);
  o.splitCap = intOr("splitCap", 30000);
  o.splitToken = $("splitToken").value;
  o.splitStyle = $("splitStyle").value;
  return o;
}

let previewTimer = null;
function renderPreview(){
  clearTimeout(previewTimer);
  previewTimer = setTimeout(doRenderPreview, 180);
  updateRowCount();
}

function doRenderPreview(){
  const host = $("previewView");
  host.innerHTML = "";
  if(!state.model){ host.appendChild(emptyBlock("Nothing scanned yet", "Load a file and press Scan.")); return; }
  const opts = buildOpts();
  if(!opts.selected.length){
    host.appendChild(emptyBlock("No paths selected",
      "Tick paths in the Tree or Flat view. The preview shows exactly what the export will write, for the first " +
      PREVIEW_ROWS + " records."));
    $("previewMeta").textContent = "";
    return;
  }
  // Never computes over the full set: only Export runs the full pass.
  const warns = [];
  let pv;
  try{
    pv = DW.pipeline.preview(state.slice, opts, PREVIEW_ROWS, {warn:function(w){ warns.push(w); }, tick:function(){}});
  }catch(e){
    host.appendChild(emptyBlock("Preview failed", String(e.message || e)));
    return;
  }
  $("previewMeta").textContent = num(pv.rows.length) + " of first " + num(state.slice.length) + " records";

  const wrap = el("div", "table-wrap");
  const table = el("table", "table");
  const thead = el("thead");
  const hr = el("tr");
  hr.appendChild(el("th", null, ""));
  for(const c of pv.columns){
    const th = el("th", null, c);
    th.title = c;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el("tbody");
  for(let i = 0; i < pv.rows.length; i++){
    const tr = el("tr");
    tr.appendChild(el("td", "num", String(i + 1)));
    for(const c of pv.columns){
      const raw = pv.rows[i][c];
      const s = raw === undefined ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
      const td = el("td", "cell", s.length > CELL_CAP ? s.slice(0, CELL_CAP) + "…" : s);
      td.title = s.length > CELL_CAP ? "click the row to see the literal output line" : s;
      td.setAttribute("dir", "auto");
      tr.appendChild(td);
    }
    // Four features mangle text on the way out — CSV quote-doubling, line-break
    // removal, big-int quoting, and the fixer's " → ' substitution. A table alone
    // would render all four correct-looking, so the literal line is one click away.
    const rawTr = el("tr", "raw hidden");
    const rawTd = el("td");
    rawTd.colSpan = pv.columns.length + 1;
    rawTd.textContent = pv.lines[i];
    rawTd.setAttribute("dir", "ltr");
    rawTr.appendChild(rawTd);
    tr.addEventListener("click", function(){ rawTr.classList.toggle("hidden"); });
    tr.style.cursor = "pointer";
    tb.appendChild(tr);
    tb.appendChild(rawTr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);
  host.appendChild(wrap);

  if(pv.header !== null){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "CSV header line"));
    const v = el("div", "val", pv.header);
    s.appendChild(v);
    host.appendChild(s);
  }
  if(warns.length){
    const s = el("div", "section");
    s.appendChild(el("h3", null, "Transform warnings in this slice"));
    const pre = el("div", "val", warns.slice(0, 40).map(function(w){ return w.detail; }).join("\n"));
    s.appendChild(pre);
    host.appendChild(s);
  }
}

