
const PREVIEW = 40;        // max chars of a value kept as a sample
const DISTINCT_CAP = 64;   // enum candidates are truncated to this before storing
const SAMPLE_KEYS = 5;     // map-like nodes keep this many example key names
const VAL_CAP = 64;        // distinct values counted per node before the tally freezes
const MAX_SAFE = 9007199254740991;                 // 2^53 - 1
const LEN_EDGES = [0,1,2,4,8,16,32,64,128,512,2048,8192,32768];

/* ---------- small helpers ---------- */

function stripBom(s){ return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
function bump(map, k, n){ map.set(k, (map.get(k) || 0) + (n === undefined ? 1 : n)); }
function minN(a, b){ if(a === null) return b; if(b === null) return a; return a < b ? a : b; }
function maxN(a, b){ if(a === null) return b; if(b === null) return a; return a > b ? a : b; }
function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
function plain(v){ return v !== null && typeof v === "object" && !Array.isArray(v); }

function typeOf(v){
  if(v === null || v === undefined) return "null";
  if(Array.isArray(v)) return "arr";
  const t = typeof v;
  if(t === "string") return "str";
  if(t === "boolean") return "bool";
  if(t === "number") return Number.isInteger(v) ? "int" : "float";
  if(t === "object") return "obj";
  return t;
}

function parses(s){ try{ JSON.parse(s); return true; }catch(e){ return false; } }

function lenBucket(n){
  for(let i = LEN_EDGES.length - 1; i >= 0; i--) if(n >= LEN_EDGES[i]) return i;
  return 0;
}

async function asText(src){
  if(typeof src === "string") return stripBom(src);
  return stripBom(await src.text());
}

