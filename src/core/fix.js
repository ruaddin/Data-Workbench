/* ==========================================================================
   DW.fix — the scripted JSON repairer (W7, W8)
   A tokenizer that tolerates exactly the input JSON.parse rejects, deterministic
   rules expressed as span edits on the original text, and a bounded search in
   which a fix is accepted only when the result parses. Every untouched byte is
   untouched by construction, which is what makes "preserve spacing and structure
   exactly" a guarantee rather than a request.

   Three things the v1.1.0 fixer got wrong and this one does not (v1.2.0):

   - **The engine is not asked where the parse failed.** `validate()` walks the
     token stream and reports the offset itself. The old code read V8's
     "position N" out of the message text, which JavaScriptCore does not emit —
     rule 12 was silently dead in Safari and nowhere else.
   - **Parsing is necessary but not sufficient for acceptance.** A repair can
     parse and still mean something else: `{"a":1}{"b":2}` was being "fixed" into
     one object with the key `a':1}{'b`. Structurally hopeless input is now
     classified and refused up front, and string-extending candidates may not
     swallow unbalanced brackets.
   - **One pass with a hardcoded rule pairing does not compose.** Rules now run to
     a fixpoint and the ambiguous rules are a bounded search over that, so a value
     needing a fence stripped, a brace pair peeled and quotes converted comes out
     in one go.
   ========================================================================== */

const fix = (function(){

const CLOSER = {'"':'"', "'":"'", "“":"”", "”":"”", "‘":"’", "’":"’"};
const QUOTES = '"\'“”‘’';
const PUNCT  = '{}[]:,=';
const INVIS  = /[\uFEFF\u00A0\u2007\u202F\u200B\u200C\u200D\u2060]/;

// Search limits. The budget counts parse attempts, which is what actually costs
// at 500 MB scale; long values get a smaller one because each attempt on a
// 200k-character value is orders of magnitude dearer than on a short one.
const DEPTH = 2;
const BIG = 50000;
function budgetFor(text){ return text.length > BIG ? 40 : 400; }

// Tolerant scanner. Must never throw: it exists to describe malformed text.
function tokenize(text){
  const T = [], n = text.length;
  let i = 0;
  while(i < n){
    const c = text[i];
    if(c === " " || c === "\t" || c === "\n" || c === "\r"){ i++; continue; }
    if(c === "/" && (text[i+1] === "/" || text[i+1] === "*")){
      let j;
      if(text[i+1] === "/"){ j = text.indexOf("\n", i + 2); if(j < 0) j = n; }
      else { j = text.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; }
      T.push({t:"c", s:i, e:j});
      i = j; continue;
    }
    if(QUOTES.indexOf(c) >= 0){
      const close = CLOSER[c];
      let j = i + 1, closed = false;
      while(j < n){
        const d = text[j];
        if(d === "\\"){ j += 2; continue; }
        if(d === close){ closed = true; j++; break; }
        j++;
      }
      T.push({t:"s", s:i, e:j, q:c, closed:closed});
      i = j; continue;
    }
    if(PUNCT.indexOf(c) >= 0){ T.push({t:"p", s:i, e:i+1, v:c}); i++; continue; }
    let j = i;
    while(j < n && PUNCT.indexOf(text[j]) < 0 && QUOTES.indexOf(text[j]) < 0 && text[j] !== "\n" &&
          !(text[j] === "/" && (text[j+1] === "/" || text[j+1] === "*"))) j++;
    let e = j;
    while(e > i && /\s/.test(text[e-1])) e--;
    if(e > i) T.push({t:"w", s:i, e:e, v:text.slice(i, e)});
    i = j > i ? j : i + 1;
  }
  return T;
}

function applyEdits(text, edits){
  if(!edits.length) return text;
  edits.sort(function(a, b){ return a.s - b.s; });
  let out = "", pos = 0;
  for(const ed of edits){
    if(ed.s < pos) continue;                 // overlapping edits: first wins
    out += text.slice(pos, ed.s) + ed.t;
    pos = ed.e;
  }
  return out + text.slice(pos);
}

function quoteStr(inner){
  return JSON.stringify(inner);
}

// Inner text of a string token, with the token's own escapes made literal enough
// to re-quote. Escaped delimiters become the plain character.
function innerOf(text, tk){
  const raw = text.slice(tk.s + 1, tk.closed ? tk.e - 1 : tk.e);
  return raw.replace(/\\(.)/g, function(m, ch){
    if(ch === "n") return "\n";
    if(ch === "t") return "\t";
    if(ch === "r") return "\r";
    if(ch === "\\") return "\\";
    if(ch === '"' || ch === "'") return ch;
    return m;
  });
}

const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const LITERAL = {"true":1, "false":1, "null":1};
const PY = {True:"true", False:"false", None:"null", undefined:"null", NaN:"null",
            TRUE:"true", FALSE:"false", NULL:"null", Null:"null", nil:"null",
            Infinity:"null", "-Infinity":"null", inf:"null", "-inf":"null"};

function nonComment(T){ return T.filter(function(t){ return t.t !== "c"; }); }

// A bare word that could stand as a JSON scalar once the deterministic rules have
// had their turn. Used only to tell "this is broken JSON" from "this is prose".
function scalarWord(v){ return NUMERIC.test(v) || has(LITERAL, v) || has(PY, v); }

/* ==========================================================================
   validate — where the parse breaks, and why, without asking the engine.
   Returns {pos, cause}. `cause` is null when the token stream walks as valid
   JSON structure; that is not the same as parsing (raw control characters and
   bad escapes walk fine and still fail JSON.parse), so JSON.parse remains the
   only thing that can accept a repair. This exists to aim the search and to
   classify residue.
   ========================================================================== */

function validate(text){
  const T = nonComment(tokenize(text));
  if(!T.length) return {pos:0, cause:"not json"};

  // A root bare word that is not a scalar is prose — but only when there is no
  // object or array anywhere in the value. A fenced block opens on ```json and a
  // model's preamble opens on "Here is the JSON:"; both are damaged JSON with
  // something wrapped around it, and both have a `{` further in.
  const rootIsWord = T[0].t === "w" && !scalarWord(T[0].v);
  if(rootIsWord){
    let structural = false;
    for(const t of T) if(t.t === "p" && (t.v === "{" || t.v === "[")){ structural = true; break; }
    if(!structural) return {pos:T[0].s, cause:"not json"};
  }

  const stack = [];
  let st = "value";
  for(let i = 0; i < T.length; i++){
    const t = T[i];
    if(t.t === "s" && !t.closed) return {pos:t.s, cause:"truncated"};
    const top = stack[stack.length - 1];

    if(st === "value"){
      if(t.t === "p" && t.v === "["){ stack.push("arr"); st = "value"; continue; }
      if(t.t === "p" && t.v === "{"){ stack.push("obj"); st = "key"; continue; }
      if(t.t === "p" && t.v === "]" && top === "arr"){ stack.pop(); st = "comma"; continue; }
      if(t.t === "s" || t.t === "w"){ st = "comma"; continue; }
      return {pos:t.s, cause:"unexpected"};
    }
    if(st === "key"){
      if(t.t === "p" && t.v === "}" && top === "obj"){ stack.pop(); st = "comma"; continue; }
      if(t.t === "s" || t.t === "w"){ st = "colon"; continue; }
      return {pos:t.s, cause:"unexpected"};
    }
    if(st === "colon"){
      if(t.t === "p" && (t.v === ":" || t.v === "=")){ st = "value"; continue; }
      return {pos:t.s, cause:"unexpected"};
    }
    // st === "comma": a value just completed
    if(t.t === "p" && t.v === ","){ st = top === "obj" ? "key" : "value"; continue; }
    if(t.t === "p" && t.v === "}" && top === "obj"){ stack.pop(); st = "comma"; continue; }
    if(t.t === "p" && t.v === "]" && top === "arr"){ stack.pop(); st = "comma"; continue; }
    if(!stack.length){
      // The root value is complete and there is more text. Another root is the
      // spec's leave-unchanged case; a trailing bare word is a model signing off.
      // ...but only if what completed was a real root. A leading bare word is a
      // fence or a preamble, and the object after it is the payload, not a
      // second root.
      const more = (t.t === "p" && (t.v === "{" || t.v === "[")) || t.t === "s" ||
                   (t.t === "w" && scalarWord(t.v));
      return {pos:t.s, cause: (more && !rootIsWord) ? "concatenated-roots" : "unexpected"};
    }
    return {pos:t.s, cause:"unexpected"};
  }
  if(stack.length || st !== "comma") return {pos:text.length, cause:"truncated"};
  return {pos:-1, cause:null};
}

const CAUSE_TEXT = {
  "truncated":          "value is cut off — the JSON ends mid-structure",
  "concatenated-roots": "two or more root values concatenated — left unchanged by design",
  "not json":           "not JSON — no object, array or scalar at the root",
  "unexpected":         "structure does not parse and no candidate repair did either",
  "empty value":        "empty value",
  "not a string":       "not a string"
};

/* ==========================================================================
   The deterministic rules. Each is a pure text → text|null; null means "did not
   fire". Every one opens with a cheap substring guard, because they run to a
   fixpoint and tokenising a 200k-character value thirteen times per pass for
   nothing is the difference between instant and not.
   ========================================================================== */

const rules = {
  // 11 · BOM, NBSP, invisible whitespace — outside strings only, where they are
  // punctuation-shaped rather than content.
  invisible(text){
    if(!INVIS.test(text)) return null;
    const T = tokenize(text);
    const mask = new Uint8Array(text.length);
    for(const t of T) if(t.t === "s") for(let i = t.s; i < t.e; i++) mask[i] = 1;
    let out = "", hit = false;
    for(let i = 0; i < text.length; i++){
      const c = text[i];
      if(!mask[i] && INVIS.test(c)){ hit = true; out += (c === "\uFEFF" ? "" : " "); continue; }
      out += c;
    }
    return hit ? out : null;
  },

  // 13 · markdown code fences. A model told to emit JSON emits a fenced block
  // often enough that this is a rule and not a curiosity.
  fences(text){
    if(text.indexOf("```") < 0) return null;
    const m = /^\s*```[A-Za-z0-9_+-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```\s*$/.exec(text);
    if(m) return m[1].trim();
    const open = /^\s*```[A-Za-z0-9_+-]*[ \t]*\r?\n?/.exec(text);   // opened, never closed
    return open ? text.slice(open[0].length).trim() : null;
  },

  // 10 · // and /* */ comments
  comments(text){
    if(text.indexOf("//") < 0 && text.indexOf("/*") < 0) return null;
    const edits = [];
    for(const t of tokenize(text)) if(t.t === "c") edits.push({s:t.s, e:t.e, t:""});
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 4 · trailing comma before } or ]
  trailingComma(text){
    if(text.indexOf(",") < 0) return null;
    const T = nonComment(tokenize(text));
    const edits = [];
    for(let i = 0; i < T.length - 1; i++){
      if(T[i].t === "p" && T[i].v === "," && T[i+1].t === "p" && (T[i+1].v === "}" || T[i+1].v === "]")){
        edits.push({s:T[i].s, e:T[i].e, t:""});
      }
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 9 · True / False / None / undefined / NaN / Infinity → JSON literals (outside
  // strings by construction: only bare-word tokens are considered)
  pythonLiterals(text){
    const edits = [];
    for(const t of tokenize(text)){
      if(t.t === "w" && has(PY, t.v)) edits.push({s:t.s, e:t.e, t:PY[t.v]});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 8 · = used where : belongs
  equalsColon(text){
    if(text.indexOf("=") < 0) return null;
    const edits = [];
    for(const t of tokenize(text)) if(t.t === "p" && t.v === "=") edits.push({s:t.s, e:t.e, t:":"});
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 2 · smart/curly quotes → straight, *where delimiting*. Positional by
  // construction: the tokenizer only opens a string on a curly quote at a token
  // boundary, so a curly quote inside a double-quoted value is never touched.
  smartQuotes(text){
    if(!/[“”‘’]/.test(text)) return null;
    const edits = [];
    for(const t of tokenize(text)){
      if(t.t === "s" && t.q !== '"' && t.q !== "'") edits.push({s:t.s, e:t.e, t:quoteStr(innerOf(text, t))});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 1 · single → double quotes on keys and values
  singleQuotes(text){
    if(text.indexOf("'") < 0) return null;
    const edits = [];
    for(const t of tokenize(text)){
      if(t.t === "s" && t.q === "'") edits.push({s:t.s, e:t.e, t:quoteStr(innerOf(text, t))});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 6 · unquoted keys
  unquotedKeys(text){
    const T = nonComment(tokenize(text));
    const edits = [];
    for(let i = 0; i < T.length - 1; i++){
      if(T[i].t === "w" && T[i+1].t === "p" && T[i+1].v === ":"){
        edits.push({s:T[i].s, e:T[i].e, t:quoteStr(T[i].v)});
      }
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 7 · unquoted bare-word values that are not number / bool / null. Never at the
  // root: a lone bare word there is prose, and quoting it would turn "sorry, I
  // can't help with that" into a successful parse.
  bareValues(text){
    const T = nonComment(tokenize(text));
    if(T.length === 1 && T[0].t === "w") return null;
    const edits = [];
    for(let i = 0; i < T.length; i++){
      const t = T[i];
      if(t.t !== "w") continue;
      if(T[i+1] && T[i+1].t === "p" && T[i+1].v === ":") continue;     // it is a key
      if(NUMERIC.test(t.v) || has(LITERAL, t.v)) continue;
      // A bare run wedged directly against a string on either side is not a bare
      // value — it is text that fell out of a string whose quoting went wrong.
      // Leave it for the extend-string search, which can actually read it.
      if(T[i-1] && T[i-1].t === "s" && T[i-1].e === t.s) continue;
      if(T[i+1] && T[i+1].t === "s" && T[i+1].s === t.e) continue;
      edits.push({s:t.s, e:t.e, t:quoteStr(t.v)});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 14 · raw control characters inside strings. A model emitting multi-line
  // reasoning into a JSON string produces these constantly.
  controlChars(text){
    if(!/[\u0000-\u001F]/.test(text)) return null;
    const edits = [];
    for(const t of tokenize(text)){
      if(t.t !== "s") continue;
      const s = t.s + 1, e = t.closed ? t.e - 1 : t.e;
      let out = "", hit = false;
      for(let i = s; i < e; i++){
        const c = text[i];
        if(c === "\\"){ out += c + (text[i+1] || ""); i++; continue; }
        const cc = c.charCodeAt(0);
        if(cc < 0x20){
          hit = true;
          out += cc === 10 ? "\\n" : cc === 9 ? "\\t" : cc === 13 ? "\\r" :
                 "\\u" + ("000" + cc.toString(16)).slice(-4);
        } else out += c;
      }
      if(hit) edits.push({s:s, e:e, t:out});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 15 · invalid escapes inside double-quoted strings. All-or-nothing per string:
  // a value containing `\d` was not written with JSON escaping in mind, so its
  // `\b` is a Windows path separator and not a backspace. Runs on `"` strings
  // only — single-quoted ones are re-emitted through JSON.stringify by rule 1,
  // which produces valid escapes by construction.
  badEscapes(text){
    if(text.indexOf("\\") < 0) return null;
    const VALID = '"\\/bfnrtu';
    const edits = [];
    for(const t of tokenize(text)){
      if(t.t !== "s" || t.q !== '"') continue;
      const s = t.s + 1, e = t.closed ? t.e - 1 : t.e;
      let bad = false;
      for(let i = s; i < e; i++){
        if(text[i] !== "\\") continue;
        const n = text[i+1];
        if(n === undefined || VALID.indexOf(n) < 0){ bad = true; break; }
        if(n === "u" && !/^[0-9a-fA-F]{4}/.test(text.slice(i+2, i+6))){ bad = true; break; }
        i++;
      }
      if(!bad) continue;
      let out = "";
      for(let i = s; i < e; i++){
        if(text[i] === "\\" && text[i+1] === "\\"){ out += "\\\\"; i++; continue; }
        out += text[i] === "\\" ? "\\\\" : text[i];
      }
      edits.push({s:s, e:e, t:out});
    }
    return edits.length ? applyEdits(text, edits) : null;
  },

  // 5 · missing comma *where unambiguous* — which is exactly a tokenizer
  // boundary check: a completed value followed directly by the start of another.
  missingCommas(text){
    const T = nonComment(tokenize(text));
    const ends = function(t){ return t.t === "s" || t.t === "w" || (t.t === "p" && (t.v === "}" || t.v === "]")); };
    const opens = function(t){ return t.t === "s" || t.t === "w" || (t.t === "p" && (t.v === "{" || t.v === "[")); };
    const edits = [];
    for(let i = 0; i < T.length - 1; i++){
      if(!ends(T[i]) || !opens(T[i+1])) continue;
      // A string and a bare word with nothing at all between them is not a
      // missing comma — it is a string that lost its closing quote. Inserting
      // here would destroy the reading the extend-string search is about to
      // find, so leave it, exactly as bareValues does for the same shape.
      if(T[i].e === T[i+1].s &&
         ((T[i].t === "s" && T[i+1].t === "w") || (T[i].t === "w" && T[i+1].t === "s"))) continue;
      edits.push({s:T[i].e, e:T[i].e, t:","});
    }
    return edits.length ? applyEdits(text, edits) : null;
  }
};

// Order matters: shells off (fences), then lexical normalisation, then the rules
// that read structure. `bareValues` and `missingCommas` go last because they are
// the two that will happily act on text the earlier rules would have re-quoted.
const ORDER = ["fences", "invisible", "comments", "controlChars", "trailingComma",
               "pythonLiterals", "equalsColon", "smartQuotes", "singleQuotes",
               "badEscapes", "unquotedKeys", "bareValues", "missingCommas"];

// Deterministic rules to a fixpoint. Returns as soon as the text parses, so the
// common case pays for one pass and not three.
function detFixpoint(text){
  let cur = text;
  for(let pass = 0; pass < 3; pass++){
    let fired = false;
    for(const name of ORDER){
      const next = rules[name](cur);
      if(next === null || next === cur) continue;
      cur = next;
      fired = true;
      if(parses(cur)) return cur;
    }
    if(!fired) break;
  }
  return cur;
}

/* ==========================================================================
   The ambiguous rules. Each yields candidate readings rather than an answer;
   the search decides, and only a successful JSON.parse accepts.
   ========================================================================== */

// 3 · extra / duplicate / stray brackets. The outer pair goes first because
// wrapping an array in braces — `{ [ ... ] }` — is the single most common shape
// a model produces, and it needs two deletions that no single-deletion search
// can reach.
function bracketCandidates(text){
  const out = [];
  // Peel the outer pair first, and do it on the characters rather than the
  // tokens: an unterminated quote further in swallows the closing brackets into
  // a string token, so the token stream cannot see a pair that is plainly there
  // in the text. `{ [ ... ] }` with a broken string inside is exactly that case.
  const t = text.trim();
  const a = t[0], z = t[t.length - 1];
  if(t.length > 2 && (a === "{" || a === "[") && (z === "}" || z === "]"))
    out.push([t.slice(1, -1), "bracketPair"]);

  const T = nonComment(tokenize(text));
  const brackets = [];
  for(const tk of T) if(tk.t === "p" && "{}[]".indexOf(tk.v) >= 0) brackets.push(tk);
  if(brackets.length < 2) return out;
  const score = function(idx){
    const t = brackets[idx];
    const prev = brackets[idx-1], next = brackets[idx+1];
    if((prev && prev.v === t.v && prev.e === t.s) || (next && next.v === t.v && next.e === t.s)) return 0;
    if(idx === 0 || idx === brackets.length - 1) return 1;
    return 2;
  };
  const order = brackets.map(function(_, i){ return i; })
                        .sort(function(a, b){ return score(a) - score(b) || a - b; })
                        .slice(0, 30);
  for(const idx of order){
    const t = brackets[idx];
    out.push([text.slice(0, t.s) + text.slice(t.e), "strayBracket"]);
  }
  return out;
}

// 16 · prose around the payload — "Here is the JSON: {...}", "{...} Hope this
// helps!". Takes the span from the first opening bracket to the last closing one.
function proseCandidates(text){
  const T = nonComment(tokenize(text));
  let first = -1, last = -1;
  for(let i = 0; i < T.length; i++){
    if(T[i].t === "p" && (T[i].v === "{" || T[i].v === "[")){ first = i; break; }
  }
  for(let i = T.length - 1; i >= 0; i--){
    if(T[i].t === "p" && (T[i].v === "}" || T[i].v === "]")){ last = i; break; }
  }
  if(first < 0 || last <= first) return [];
  if(T[first].s === 0 && T[last].e === text.length) return [];   // nothing around it
  return [[text.slice(T[first].s, T[last].e), "proseTrim"]];
}

// Brackets swallowed by an extended string must balance. This is what stops
// `{"a":1}{"b":2}` becoming one object keyed `a':1}{'b` — a repair that parses
// and is nonsense. Commas and colons are not counted: prose is full of them.
function balancedSpan(text, s, e){
  let depth = 0;
  for(let i = s; i < e; i++){
    const c = text[i];
    if(c === "{" || c === "[") depth++;
    else if(c === "}" || c === "]"){ depth--; if(depth < 0) return false; }
  }
  return depth === 0;
}

// 1-edge / 12 · a string that ran long: an unescaped `"` inside a double-quoted
// value, or an apostrophe inside a single-quoted one. Same search either way —
// re-close the string at a later delimiter and re-emit it through
// JSON.stringify, which escapes whatever was interior. Lossless: the old rule
// substituted `'` for interior `"` and changed the content.
function extendCandidates(text, q){
  if(text.indexOf(q) < 0) return [];
  const err = validate(text);
  const pos = err.pos < 0 ? text.length : err.pos;
  const T = tokenize(text);
  const heads = [];
  for(const t of T) if(t.t === "s" && t.q === q && t.s <= pos) heads.push(t);
  const out = [];
  for(const tk of heads.slice(-3).reverse()){
    if(!tk.closed) continue;
    let n = 0;
    for(let j = tk.e; j < text.length && n < 12; j++){
      if(text[j] === "\\"){ j++; continue; }
      if(text[j] !== q) continue;
      n++;
      if(!balancedSpan(text, tk.e, j)) continue;
      const inner = text.slice(tk.s + 1, j).replace(/\\(.)/g, function(m, ch){
        if(ch === "n") return "\n";
        if(ch === "t") return "\t";
        if(ch === "r") return "\r";
        if(ch === "\\") return "\\";
        if(ch === '"' || ch === "'") return ch;
        return m;
      });
      out.push([text.slice(0, tk.s) + quoteStr(inner) + text.slice(j + 1), "extendString"]);
    }
  }
  return out;
}

function ambiguousCandidates(text){
  return [].concat(proseCandidates(text),
                   extendCandidates(text, '"'),
                   extendCandidates(text, "'"),
                   bracketCandidates(text));
}

/* --- duplicate keys: detected, never repaired (JSON.parse keeps the last
       occurrence and destroys the evidence before any consumer sees it) --- */

function duplicateKeys(text){
  const T = nonComment(tokenize(text));
  const stack = [];
  const dups = [];
  for(let i = 0; i < T.length; i++){
    const t = T[i];
    if(t.t === "p" && t.v === "{"){ stack.push(new Set()); continue; }
    if(t.t === "p" && (t.v === "}" || t.v === "]")){ if(t.v === "}") stack.pop(); continue; }
    if(t.t === "p" && t.v === "["){ stack.push(null); continue; }
    if((t.t === "s" || t.t === "w") && T[i+1] && T[i+1].t === "p" && T[i+1].v === ":"){
      const top = stack[stack.length - 1];
      if(!top) continue;
      const name = t.t === "s" ? text.slice(t.s + 1, t.closed ? t.e - 1 : t.e) : t.v;
      if(top.has(name)) dups.push(name); else top.add(name);
    }
  }
  return dups;
}

/* --- how many characters an accepted fix moved --- */

function changedChars(a, b){
  let p = 0;
  const min = Math.min(a.length, b.length);
  while(p < min && a[p] === b[p]) p++;
  let s = 0;
  while(s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return Math.max(a.length - p - s, b.length - p - s);
}

/* ==========================================================================
   The verify-loop (W8): deterministic rules to a fixpoint, then a bounded
   search over the ambiguous ones, re-running the deterministic rules after
   every candidate so that a fence, a brace pair and a quote conversion compose.
   ========================================================================== */

function search(text, depth, found, budget, trail){
  if(budget.n <= 0) return;
  budget.n--;
  const cur = detFixpoint(text);
  if(parses(cur)){ found.push({out:cur, rule:trail || "deterministic"}); return; }
  if(depth <= 0) return;
  // Candidates come off the *untouched* text as well as the rewritten one. A
  // deterministic rule that fired without fixing anything otherwise hides the
  // reading that would have worked: `{'a': 'it's fine'}` has its quotes
  // converted by rule 1 into a shape where the apostrophe is no longer
  // recoverable, and the original is the only text the search can still read.
  const bases = cur === text ? [cur] : [text, cur];
  for(const base of bases){
    for(const c of ambiguousCandidates(base)){
      if(budget.n <= 0 || found.length >= 4) return;
      search(c[0], depth - 1, found, budget, trail ? trail + "+" + c[1] : c[1]);
    }
  }
}

function repair(text){
  if(typeof text !== "string")
    return {ok:false, out:text, rule:null, changed:0, reason:"not a string", cause:"not a string"};
  const trimmed = text.trim();
  if(trimmed === "")
    return {ok:false, out:text, rule:null, changed:0, reason:"empty value", cause:"empty value"};
  if(parses(trimmed))
    return {ok:true, out:trimmed, rule:null, changed:0, reason:null, cause:null, clean:true};

  // Structurally hopeless or deliberately out of scope: say so instead of
  // searching for a reading that would have to invent data to exist.
  const v = validate(trimmed);
  if(v.cause === "truncated" || v.cause === "concatenated-roots" || v.cause === "not json")
    return {ok:false, out:text, rule:null, changed:0, reason:CAUSE_TEXT[v.cause], cause:v.cause};

  const found = [];
  search(trimmed, DEPTH, found, {n:budgetFor(trimmed)}, null);
  if(found.length){
    // Every candidate here has already parsed; the tie-break is fewest characters
    // changed, which is what keeps a big rewrite from beating a small correct one.
    found.sort(function(a, b){ return changedChars(trimmed, a.out) - changedChars(trimmed, b.out); });
    return {ok:true, out:found[0].out, rule:found[0].rule,
            changed:changedChars(trimmed, found[0].out), reason:null, cause:null};
  }
  // Exhausted: hand back the input byte-identical, with the cause.
  const cause = v.cause || "unexpected";
  return {ok:false, out:text, rule:null, changed:0, reason:CAUSE_TEXT[cause] || cause, cause:cause};
}

// Runs repair across one path's values. Populates the "941/1000 parse · 59 fail"
// readout, the residue list, the per-cause tally and the duplicate-key warnings.
function scanPath(records, path){
  const steps = readers.parsePath(path);
  const out = {total:0, parsed:0, repaired:0, residue:[], dups:[], values:[], causes:{}};
  for(let i = 0; i < records.length; i++){
    const refs = valueRefs(records[i], steps);
    for(let o = 0; o < refs.length; o++){
      const raw = refs[o].o[refs[o].k];
      if(typeof raw !== "string") continue;
      out.total++;
      const r = repair(raw);
      if(r.ok){
        if(r.clean) out.parsed++; else out.repaired++;
        out.values.push(JSON.parse(r.out));
        if(out.dups.length < 200){
          for(const d of duplicateKeys(r.out)) out.dups.push({i:i, o:o, key:d});
        }
      } else {
        out.causes[r.cause] = (out.causes[r.cause] || 0) + 1;
        if(out.residue.length < 5000)
          out.residue.push({i:i, o:o, path:path, reason:r.reason, cause:r.cause, raw:raw});
      }
    }
  }
  return out;
}

return {tokenize:tokenize, repair:repair, scanPath:scanPath, duplicateKeys:duplicateKeys,
        rules:rules, validate:validate, detFixpoint:detFixpoint,
        bracketCandidates:bracketCandidates, extendCandidates:extendCandidates,
        proseCandidates:proseCandidates, CAUSE_TEXT:CAUSE_TEXT};
})();

