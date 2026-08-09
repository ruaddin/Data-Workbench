/* ---------- small DOM helpers ---------- */

function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
  });
}
// One formatter, reused: num() runs several times per rendered row, and building
// a fresh Intl formatter per call is the expensive half of toLocaleString.
const NUMFMT = new Intl.NumberFormat();
function num(n){ return (n === null || n === undefined) ? "" : NUMFMT.format(Number(n)); }
function fmtBytes(n){
  const u = ["B","KB","MB","GB"];
  let i = 0;
  while(n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + " " + u[i];
}
function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
function show(id){ $(id).classList.remove("hidden"); }
function hide(id){ $(id).classList.add("hidden"); }

const ICON_OK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';
const ICON_ERR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>';
const ICON_INFO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

function status(id, kind, html){
  const e = $(id);
  e.className = "status status-" + kind;
  e.innerHTML = (kind === "ok" ? ICON_OK : kind === "err" ? ICON_ERR : ICON_INFO) + "<span>" + html + "</span>";
  e.setAttribute("role", kind === "err" ? "alert" : "status");
}

/* ---------- theme (in memory: W14 forbids browser storage of any kind) ---------- */

let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
function paintTheme(){
  document.documentElement.dataset.theme = theme;
  $("themeBtn").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  $("themeIcon").innerHTML = theme === "dark"
    ? '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>';
}
paintTheme();
$("themeBtn").addEventListener("click", function(){ theme = theme === "dark" ? "light" : "dark"; paintTheme(); });
