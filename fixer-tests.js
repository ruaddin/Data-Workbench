// DW.fix test suite — run with:  node fixer-tests.js
//
// Extracts <script id="dw-core"> from index.html and exercises DW.fix under Node,
// the same way the v1.0.0 and v1.1.0 suites did. Two things make this one worth
// keeping in the repo rather than re-deriving each time:
//
//   - Cases assert the exact parsed VALUE, or the exact residue CAUSE. A pass/fail
//     harness would have called v1.1.0 green on {"a":1}{"b":2}, which it happily
//     "repaired" into a single object whose one key was  a':1}{'b .
//   - Every case runs twice, the second time with JSON.parse wrapped to throw
//     JavaScriptCore-shaped messages, asserting zero drift between engines. That is
//     the regression test for rule 12 having been silently dead in Safari, and it
//     fails the moment anything in DW.fix starts reading an exception message again.

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const HTML = path.join(__dirname, "index.html");

function loadCore(){
  const src = fs.readFileSync(HTML, "utf8");
  const open = src.indexOf('<script id="dw-core">');
  if(open < 0) throw new Error("dw-core script tag not found");
  const start = src.indexOf(">", open) + 1;
  const end = src.indexOf("</script>", start);
  const ctx = {console:console};
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + "\n;globalThis.__DW = DW;", ctx, {filename:"dw-core"});
  return ctx.__DW;
}

// Simulates JavaScriptCore (Safari): its JSON errors carry no "position N".
const realParse = JSON.parse;
function jscMode(on){
  JSON.parse = on ? function(t, r){
    try{ return realParse.call(JSON, t, r); }
    catch(e){ throw new SyntaxError("JSON Parse error: " + e.message.replace(/ in JSON at position \d+.*$/, "")); }
  } : realParse;
}

function deepEq(a, b){
  if(a === b) return true;
  if(typeof a !== typeof b || a === null || b === null) return false;
  if(typeof a !== "object") return false;
  if(Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if(ka.length !== kb.length) return false;
  for(const k of ka){ if(!(k in b) || !deepEq(a[k], b[k])) return false; }
  return true;
}

/* ========================================================================== */
/*  The corpus.   v: must repair (or be clean) to this exact value.           */
/*                residue: must be refused, with this exact cause.            */
/* ========================================================================== */

const R = String.raw;

const CORPUS = [

/* ---- v1.1.0 behaviour: the regression floor ---------------------------- */
["clean",                    R`{"a": 1}`,                          {v:{a:1}}],
["single quotes",            R`{'a': 'x'}`,                        {v:{a:"x"}}],
["sq + interior dquote",     R`{'a': 'he said "hi"'}`,             {v:{a:'he said "hi"'}}],
["trailing comma obj",       R`{"a": 1,}`,                         {v:{a:1}}],
["trailing comma arr",       R`[1, 2,]`,                           {v:[1,2]}],
["python literals",          R`{"a": True, "b": None, "c": False}`,{v:{a:true,b:null,c:false}}],
["python dict repr",         R`{'a': True, 'b': [1, 2]}`,          {v:{a:true,b:[1,2]}}],
["unquoted keys",            R`{a: 1, b: "x"}`,                    {v:{a:1,b:"x"}}],
["missing comma",            R`{"a": 1 "b": 2}`,                   {v:{a:1,b:2}}],
["missing comma strings",    R`{"a": "x" "b": "y"}`,               {v:{a:"x",b:"y"}}],
["equals for colon",         R`{"a" = 1}`,                         {v:{a:1}}],
["line comment",             '{"a": 1 // note\n}',                 {v:{a:1}}],
["block comment",            R`{"a": /* x */ 1}`,                  {v:{a:1}}],
["smart quotes",             '{\u201ca\u201d: \u201cx\u201d}',     {v:{a:"x"}}],
["BOM",                      '\uFEFF{"a": 1}',                     {v:{a:1}}],
["NBSP between tokens",      '{"a":\u00A01}',                      {v:{a:1}}],
["nested embedded",          R`{'outer': {'inner': 'v'}}`,         {v:{outer:{inner:"v"}}}],
["array of dicts multiline", "[\n  {'r': 'a \"b\" c'},\n  {'r': 'd'}\n]", {v:[{r:'a "b" c'},{r:"d"}]}],
["spec example rule 12",     R`{"note": "he said "hi", ok"}`,      {v:{note:'he said "hi", ok'}}],

/* ---- bracket pairs: the reported failure -------------------------------- */
["wrapper brace + array",    R`{ [{"a": 1}, {"a": 2}] }`,          {v:[{a:1},{a:2}]}],
["wrapper brace + sq",       R`{ [{'a': 'x'}] }`,                  {v:[{a:"x"}]}],
["wrapper, no closer",       R`{ [{"a": 1}]`,                      {v:[{a:1}]}],
["double brace",             R`{{"a": 1}}`,                        {v:{a:1}}],
["double bracket (legal)",   R`[[{"a": 1}]]`,                      {v:[[{a:1}]]}],
["bracket + obj (legal)",    R`[ {"a": 1} ]`,                      {v:[{a:1}]}],
["reported value",
  R`{ [{'reason': 'the previous answer used "soles" as the unit, but the assistant repeated it'}, {'reason': 'second'}] }`,
  {v:[{reason:'the previous answer used "soles" as the unit, but the assistant repeated it'},{reason:"second"}]}],

/* ---- engine independence: rule 12 without V8 messages ------------------- */
["dq interior",              R`{"a": "he said "hi" ok"}`,          {v:{a:'he said "hi" ok'}}],
["dq interior 2 fields",     R`{"a": "he said "hi"", "b": "z"}`,   {v:{a:'he said "hi"',b:"z"}}],
["dq interior long doc",     R`{"a": "he said "hi" ok", "b": "plain", "c": "more", "d": 1}`,
                                                                   {v:{a:'he said "hi" ok',b:"plain",c:"more",d:1}}],
["dq interior in array",     R`["plain", "he said "hi" ok"]`,      {v:["plain",'he said "hi" ok']}],

/* ---- acceptance guard: refuse, never corrupt --------------------------- */
["concatenated roots",       R`{"a":1}{"b":2}`,                    {residue:"concatenated-roots"}],
["concatenated arrays",      R`[1][2]`,                            {residue:"concatenated-roots"}],
["concatenated ndjson",      '{"a":1}\n{"b":2}',                   {residue:"concatenated-roots"}],

/* ---- rule 1 edge case: apostrophes inside single quotes ---------------- */
["sq apostrophe",            R`{'a': 'the user's answer'}`,        {v:{a:"the user's answer"}}],
["sq apostrophe 2 fields",   R`{'a': 'it's fine', 'b': 'x'}`,      {v:{a:"it's fine",b:"x"}}],
["sq apostrophe in array",   R`[{'r': 'don't do that'}]`,          {v:[{r:"don't do that"}]}],

/* ---- raw control characters inside strings ----------------------------- */
["raw newline",              '{"a": "line1\nline2"}',              {v:{a:"line1\nline2"}}],
["raw tab",                  '{"a": "col1\tcol2"}',                {v:{a:"col1\tcol2"}}],
["raw CR",                   '{"a": "x\ry"}',                      {v:{a:"x\ry"}}],
["raw newline + sq",         "{'a': 'line1\nline2'}",              {v:{a:"line1\nline2"}}],

/* ---- markdown fences and prose wrappers -------------------------------- */
["json fence",               '```json\n{"a": 1}\n```',             {v:{a:1}}],
["bare fence",               '```\n{"a": 1}\n```',                 {v:{a:1}}],
["fence + sq",               "```json\n{'a': 'x'}\n```",           {v:{a:"x"}}],
["prose prefix",             R`Here is the JSON: {"a": 1}`,        {v:{a:1}}],
["prose suffix",             R`{"a": 1} Hope this helps!`,         {v:{a:1}}],
["prose both sides",         R`Sure! {"a": 1} Let me know.`,       {v:{a:1}}],

/* ---- invalid escapes ---------------------------------------------------- */
["bad escape \\d",           R`{"a": "match \d+ here"}`,           {v:{a:R`match \d+ here`}}],
["windows path",             R`{"a": "C:\Users\bob"}`,             {v:{a:R`C:\Users\bob`}}],
["short unicode escape",     R`{"a": "\u12"}`,                     {v:{a:R`\u12`}}],
["valid escapes untouched",  R`{"a": "tab\there\nnl \u00e9"}`,     {v:{a:"tab\there\nnl \u00e9"}}],

/* ---- truncation: classified, never guessed at -------------------------- */
["truncated string",         R`{"a": "unfinished`,                 {residue:"truncated"}],
["truncated at colon",       R`{"a": 1, "b":`,                     {residue:"truncated"}],
["truncated deep",           R`{"a": [{"b": 1}, {"c":`,            {residue:"truncated"}],

/* ---- non-JSON and degenerate inputs ------------------------------------ */
["empty",                    "",                                   {residue:"empty value"}],
["whitespace only",          "   \n ",                             {residue:"empty value"}],
["bare prose",               R`some plain text`,                   {residue:"not json"}],
["number only",              R`42`,                                {v:42}],
["null only",                R`null`,                              {v:null}],
["double-encoded json",      R`"{\"a\": 1}"`,                      {v:R`{"a": 1}`}],

/* ---- non-finite and exotic numerics ------------------------------------ */
["NaN",                      R`{"a": NaN}`,                        {v:{a:null}}],
["Infinity",                 R`{"a": Infinity, "b": -Infinity}`,   {v:{a:null,b:null}}],
["hex number",               R`{"a": 0x1F}`,                       {v:{a:"0x1F"}}],
["leading plus",             R`{"a": +1}`,                         {v:{a:"+1"}}],

/* ---- CJK / RTL payloads must survive byte-for-byte --------------------- */
["thai value",               R`{'r': 'ผู้ใช้ระบุว่า "หน่วย" ผิด'}`,     {v:{r:'ผู้ใช้ระบุว่า "หน่วย" ผิด'}}],
["arabic value",             R`{'r': 'قال المستخدم "نعم"'}`,       {v:{r:'قال المستخدم "نعم"'}}],
["chinese value",            R`{'r': '用户说"对"了'}`,                {v:{r:'用户说"对"了'}}],
["cjk full-width quotes",    R`{'r': '他说“好”了'}`,                  {v:{r:'他说“好”了'}}],

/* ---- combinations, as they actually arrive ----------------------------- */
["fence + wrapper + sq",     "```json\n{ [{'a': 'x \"y\"'}] }\n```", {v:[{a:'x "y"'}]}],
["wrapper + trailing comma", R`{ [{"a": 1},] }`,                    {v:[{a:1}]}],
["sq + trailing comma + py", R`{'a': True, 'b': 'x',}`,             {v:{a:true,b:"x"}}],
];

/* ========================================================================== */

const DW = loadCore();

function runCorpus(label){
  const rows = [];
  let n = 0;
  for(const [name, src, exp] of CORPUS){
    let got, note = "", ok = false;
    try{ got = DW.fix.repair(src); }catch(e){ note = "THREW " + e.message; }
    if(!note && exp.residue !== undefined){
      if(got.ok) note = "repaired, expected residue → " + JSON.stringify(got.out).slice(0, 70);
      else if(got.cause !== exp.residue) note = "cause " + got.cause + " ≠ " + exp.residue;
      else ok = true;
    } else if(!note){
      if(!got.ok) note = "residue: " + got.reason;
      else {
        let val;
        try{ val = JSON.parse(got.out); }catch(e){ note = "accepted output does not parse"; }
        if(!note && !deepEq(val, exp.v))
          note = "got " + JSON.stringify(val) + "  want " + JSON.stringify(exp.v);
        else if(!note) ok = true;
      }
    }
    if(ok) n++;
    rows.push({name, ok, note});
  }
  console.log("\n=== " + label + " ===");
  for(const r of rows) if(!r.ok) console.log("  FAIL  " + r.name.padEnd(26) + " " + r.note);
  console.log("  " + n + "/" + CORPUS.length + " pass");
  return {n, total:CORPUS.length, rows};
}

const v8 = runCorpus("V8 (Chrome / Node)");
jscMode(true);
const jsc = runCorpus("JavaScriptCore (Safari) — simulated");
jscMode(false);

const drift = v8.rows.filter((r, i) => r.ok !== jsc.rows[i].ok).map(r => r.name);
console.log("\nengine drift: " + (drift.length ? drift.join(", ") : "none"));

/* ---- integration: scanPath, duplicate keys, the unpack path ------------- */

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if(cond) pass++; else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
}

main();

async function main(){

const recs = [
  {id:1, payload:`[{"r": "clean"}]`},
  {id:2, payload:`{ [{'r': 'wrapped'}] }`},
  {id:3, payload:`{"r": "cut off`},
  {id:4, payload:`{"a":1}{"b":2}`},
  {id:5, payload:`sorry, I can't help with that`},
];
const res = await DW.fix.scanPath(recs, "payload");
ok("scanPath total", res.total === 5, "got " + res.total);
ok("scanPath parsed", res.parsed === 1, "got " + res.parsed);
ok("scanPath repaired", res.repaired === 1, "got " + res.repaired);
ok("scanPath residue", res.residue.length === 3, "got " + res.residue.length);
ok("cause truncated", res.causes["truncated"] === 1, JSON.stringify(res.causes));
ok("cause concatenated", res.causes["concatenated-roots"] === 1, JSON.stringify(res.causes));
ok("cause not json", res.causes["not json"] === 1, JSON.stringify(res.causes));
ok("residue carries cause", res.residue.every(r => typeof r.cause === "string"));
ok("residue raw byte-identical", res.residue.find(r => r.i === 2).raw === recs[2].payload);
ok("values collected", res.values.length === 2 && res.values[0][0].r === "clean");

const dups = DW.fix.duplicateKeys(`{"a":1,"a":2,"b":{"c":1,"c":2}}`);
ok("duplicateKeys", dups.length === 2 && dups[0] === "a" && dups[1] === "c", JSON.stringify(dups));
ok("dups via scanPath", (await DW.fix.scanPath([{p:`{'a':1,'a':2}`}], "p")).dups.length === 1);

for(const src of [`{ [{'r': 'x'}] }`, `{"r": "cut off`, `{"a":1}{"b":2}`]){
  const before = src;
  const r = DW.fix.repair(src);
  ok("input untouched: " + src.slice(0, 14), src === before);
  if(!r.ok) ok("residue out identical: " + src.slice(0, 14), r.out === src);
}

const pv = DW.pipeline.preview(
  [{id:1, blob:`{ [{'score': 3, 'why': 'it's "off"'}, {'score': 4, 'why': 'b'}] }`},
   {id:2, blob:`[{"score": 5, "why": "fine"}]`}],
  {selected:["id", "blob.[].score", "blob.[].why"], unpacked:["blob"],
   explode:"blob.[]", format:"jsonl"}, 20, null);
ok("unpack+explode row count", pv.rows.length === 3, "got " + pv.rows.length);
ok("wrapper value unpacked", pv.rows[0]["blob.[].score"] === 3, JSON.stringify(pv.rows[0]));
ok("content preserved losslessly", pv.rows[0]["blob.[].why"] === `it's "off"`,
   JSON.stringify(pv.rows[0]["blob.[].why"]));
ok("second record intact", pv.rows[2]["blob.[].why"] === "fine");

/* ---- W26: the memos are memos, not a second algorithm ------------------- */
//
// The whole safety argument is that both caches memoise pure functions. A cached
// result that differs from a computed one is a bug, so this replays the entire
// corpus through a cleared cache and then through a warm one and asserts the
// results are identical field for field — including the residue causes, which is
// where a "clever" cache would drift first.

console.log("\n=== W26 memos ===");

DW.fix.clearCache();
const cold = CORPUS.map(c => DW.fix.repair(c[1]));
const warm = CORPUS.map(c => DW.fix.repair(c[1]));
let drifted = 0;
for(let i = 0; i < CORPUS.length; i++){
  const a = cold[i], b = warm[i];
  if(a.ok !== b.ok || a.out !== b.out || a.rule !== b.rule ||
     a.changed !== b.changed || a.cause !== b.cause || a.reason !== b.reason){
    drifted++;
    console.log("  FAIL memo drift: " + CORPUS[i][0] +
                "\n    cold " + JSON.stringify(a) + "\n    warm " + JSON.stringify(b));
  }
}
ok("repair memo: no drift across the corpus", drifted === 0, drifted + " drifted");

DW.fix.clearCache();
const fresh = CORPUS.map(c => DW.fix.repair(c[1]));
ok("repair memo: cleared cache recomputes identically",
   fresh.every((r, i) => r.ok === cold[i].ok && r.out === cold[i].out && r.cause === cold[i].cause));

// Callers must not be able to write through into the map.
const alias1 = DW.fix.repair(`{'a': 1}`);
alias1.out = "TAMPERED";
const alias2 = DW.fix.repair(`{'a': 1}`);
ok("repair memo: hits are copies, not aliases", alias2.out === `{"a": 1}`, "got " + alias2.out);

// tokenize is pure whether or not the memo is live (it is live only inside repair).
const tk1 = DW.fix.tokenize(`{'a': "b", c: 1}`);
const tk2 = DW.fix.tokenize(`{'a': "b", c: 1}`);
ok("tokenize is pure", deepEq(tk1, tk2));

// The failures are the entries worth caching: they burn the whole budget every
// pass. Assert the cause survives a round trip rather than being recomputed wrong.
DW.fix.clearCache();
const r1 = DW.fix.repair(`{"r": "cut off`);
const r2 = DW.fix.repair(`{"r": "cut off`);
ok("repair memo: refusal cause cached exactly", r1.cause === "truncated" && r2.cause === "truncated" &&
   r1.reason === r2.reason && r2.out === `{"r": "cut off`);

/* ---- W28: triage's refusal is repair's refusal -------------------------- */
//
// The acceptance criterion, checkable without running a single search: for every
// value, triage's verdict must agree with what repair does with it. If these two
// ever diverge, the pane is telling you a file is hopeless while Unpack quietly
// repairs it, or the reverse.

console.log("\n=== W28 triage ===");

let mismatch = 0, counted = {parses:0, refused:0, undetermined:0};
for(const [name, src] of CORPUS){
  const t = DW.fix.triage(src);
  const r = DW.fix.repair(src);
  counted[t.verdict] = (counted[t.verdict] || 0) + 1;

  // `refused` must agree on the cause exactly — same verdict, same values.
  if(t.verdict === "refused" && (r.ok || r.cause !== t.cause)){
    mismatch++; console.log("  FAIL triage refused, repair disagreed: " + name +
                            " (" + t.cause + " vs " + (r.ok ? "repaired" : r.cause) + ")");
  }
  // `parses` must be a clean pass through repair, changing nothing.
  if(t.verdict === "parses" && !(r.ok && r.clean)){
    mismatch++; console.log("  FAIL triage said parses, repair did not: " + name);
  }
  // `undetermined` is the one verdict that may go either way — but it must never
  // be a value repair refuses outright, because that is a cause triage could have
  // named. `unexpected` means "the search ran and found nothing", which is the
  // one sentence triage can never truthfully say.
  if(t.verdict === "undetermined" && !r.ok && r.cause !== "unexpected"){
    mismatch++; console.log("  FAIL triage undetermined, repair refused up front: " +
                            name + " (" + r.cause + ")");
  }
}
ok("triage never disagrees with repair", mismatch === 0, mismatch + " mismatched");
ok("triage exercised all three verdicts",
   counted.parses > 0 && counted.refused > 0 && counted.undetermined > 0, JSON.stringify(counted));

ok("triage verdicts are not causes", DW.fix.triage(`{"a": 1 "b": 2}`).verdict === "undetermined" &&
   DW.fix.triage(`{"a": 1 "b": 2}`).cause === null);
ok("triage: empty and non-string refused",
   DW.fix.triage("").verdict === "refused" && DW.fix.triage(null).verdict === "refused");
ok("triage costs no search", DW.fix.triage(`sorry, I can't help`).cause === "not json");

/* ---- W27: the loops yield, report and stop ------------------------------ */

console.log("\n=== W27 progress and cancel ===");

// Enough distinct values that the loop is certain to cross the 50 ms yield
// interval — which is the point. Yielding is time-based, not count-based, so a
// test on a handful of cheap values would never reach a yield and would pass
// while proving nothing.
const N = 5000;
const many = [];
for(let i = 0; i < N; i++) many.push({p:`{'n': ` + i + `}`});
const breathe = () => new Promise(r => setTimeout(r, 0));

DW.fix.clearCache();
const ticks = [];
const full = await DW.fix.scanPath(many, "p", {
  breathe: breathe, total: N, cancelled: () => false, tick: t => ticks.push(t)
});
ok("scanPath with a control still repairs everything", full.total === N && full.repaired === N,
   full.total + "/" + full.repaired);
ok("scanPath yielded at all", ticks.length > 0, "no ticks in " + N + " values");
ok("scanPath reports its running tallies",
   ticks.length > 0 && ticks[0].done > 0 && ticks[0].total === N &&
   "parsed" in ticks[0] && "repaired" in ticks[0] && "residue" in ticks[0],
   JSON.stringify(ticks[0]));
ok("progress counts climb", ticks.length < 2 || ticks[ticks.length-1].done > ticks[0].done);

// Cancel stops the loop and says so, rather than running to the end.
DW.fix.clearCache();
const stopped = await DW.fix.scanPath(many, "p", {
  breathe: breathe, total: N, cancelled: () => true, tick: () => {}
});
ok("scanPath cancels", stopped.cancelled === true);
ok("cancelled scanPath stops short", stopped.total < N, "got " + stopped.total);
ok("cancelled scanPath keeps what it had",
   stopped.total === stopped.parsed + stopped.repaired + stopped.residue.length);

// Without a control it is the straight-line loop it has always been.
DW.fix.clearCache();
const plain = await DW.fix.scanPath(many, "p");
ok("scanPath without a control is unchanged", plain.total === N && plain.cancelled === false);

console.log("\n=== integration ===");
console.log("  " + pass + "/" + (pass + fail) + " pass");

const green = v8.n === v8.total && jsc.n === jsc.total && !drift.length && fail === 0;
console.log("\n" + (green ? "ALL GREEN" : "FAILURES ABOVE"));
process.exit(green ? 0 : 1);

}
