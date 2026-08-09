/* ---------- summary strip (W11: file-level facts, and nothing else) ---------- */

function showResults(){
  show("summaryStrip");
  show("workspace");
  show("exportPanel");
  renderSummary();
  renderExplodeOptions();
  renderSortOptions();
  render();
  renderPreview();
}

function renderSummary(){
  const m = state.model, s = state.stats;
  const host = $("summaryStrip");
  host.innerHTML = "";
  const cell = function(label, value, warnFlag){
    const c = el("div", "cell");
    const n = el("div", "num" + (warnFlag ? " warn" : ""), value);
    c.appendChild(n);
    c.appendChild(el("div", "label", label));
    host.appendChild(c);
  };
  cell("records", num(m.recordCount));
  cell("paths", num(countPaths(m.root)));
  cell("max depth", String(m.depth));
  cell("parse failures", num(s ? s.errCount : 0), s && s.errCount > 0);
  cell("size", state.size ? fmtBytes(state.size) : "—");
  cell("format", state.detected ? DW.detect.label(effective() || state.detected) : "—");
  host.appendChild(el("div", "spacer"));
  if(state.provisional){
    host.appendChild(el("span", "prov", "⚡ provisional — still scanning"));
  }
}

/* ---------- warnings panel (§7) — one home for every source ---------- */

const WARN_LABEL = {
  parse:"lines that failed to parse", ragged:"ragged CSV rows",
  precision:"precision-loss warnings", "flatten-collision":"flatten collisions — key left unflattened",
  "split-collision":"split-target collisions — field left unsplit",
  oversize:"oversize values not eligible for splitting", dupkey:"duplicate keys detected pre-parse",
  residue:"fixer residue that could not be repaired", miss:"records the record path missed",
  plan:"export configuration"
};

function renderWarnings(){
  const groups = new Map();
  for(const w of state.warnings){
    if(!groups.has(w.kind)) groups.set(w.kind, []);
    groups.get(w.kind).push(w);
  }
  if(!groups.size){ hide("warnPanel"); return; }
  let total = 0;
  for(const g of groups) total += g[1].length;
  $("warnSummary").innerHTML = "Warnings <span class=\"badge-count\">" + num(total) + "</span>";
  const body = $("warnBody");
  body.innerHTML = "";
  for(const g of groups){
    const d = el("details");
    const sum = el("summary");
    sum.textContent = num(g[1].length) + " · " + (WARN_LABEL[g[0]] || g[0]);
    sum.style.fontSize = "13px";
    d.appendChild(sum);
    const pre = el("pre");
    pre.style.cssText = "font-family:var(--font-mono);font-size:11.5px;white-space:pre-wrap;max-height:220px;overflow:auto;margin:6px 0 0";
    pre.textContent = g[1].slice(0, 300).map(function(w){
      return (w.line != null ? "line " + w.line + ": " : w.row != null ? "row " + w.row + ": " : "") +
             (w.path ? w.path + " — " : "") + w.detail;
    }).join("\n");
    d.appendChild(pre);
    body.appendChild(d);
  }
  show("warnPanel");
}

