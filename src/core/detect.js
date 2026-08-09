/* ---------- DW.detect (D2) ---------- */

const DELIMS = [",", "\t", ";", "|"];

// Counts delimiters outside double-quoted regions, so a quoted comma doesn't vote.
function countOutside(line, delim){
  let n = 0, q = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(ch === '"'){
      if(q && line[i+1] === '"'){ i++; continue; }
      q = !q;
    } else if(ch === delim && !q) n++;
  }
  return n;
}

function firstLines(text, max){
  const out = [];
  let start = 0;
  while(out.length < max && start <= text.length){
    let idx = text.indexOf("\n", start);
    const end = idx < 0 ? text.length : idx;
    let line = text.slice(start, end);
    if(line.endsWith("\r")) line = line.slice(0, -1);
    if(line.trim() !== "") out.push(line);
    if(idx < 0) break;
    start = idx + 1;
  }
  return out;
}

const detect = {
  // Content-based, never the file extension. Tests run strictest-first so that
  // ambiguity resolves toward the tighter grammar; YAML is last because it is
  // the loosest and would otherwise swallow everything.
  sniff(sample){
    const text = stripBom(String(sample));
    const trimmed = text.replace(/^\s+/, "");
    if(trimmed === "") return {format:"jsonl", confidence:"low"};

    const lines = firstLines(text, 30);
    const c0 = trimmed[0];

    if(c0 === "{" || c0 === "["){
      const l1 = lines[0], l2 = lines[1];
      // A JSONL file's lines each parse independently; a pretty-printed document's
      // first line ("{") does not.
      if(l1 && parses(l1.trim())){
        if(l2 && parses(l2.trim())) return {format:"jsonl", confidence:"high"};
        if(l2) return {format:"json", confidence:"medium"};
        return {format:"json", confidence: c0 === "[" ? "high" : "medium"};
      }
      return {format:"json", confidence:"high"};
    }

    if(lines.length >= 2){
      let best = null;
      for(const d of DELIMS){
        const counts = lines.map(l => countOutside(l, d));
        if(counts[0] < 1) continue;
        if(counts.every(c => c === counts[0]) && (best === null || counts[0] > best.count)){
          best = {delimiter:d, count:counts[0]};
        }
      }
      if(best) return {format:"csv", delimiter:best.delimiter,
                       confidence: lines.length >= 4 ? "high" : "medium"};
    }

    if(c0 === "<") return {format:"xml", confidence:"high"};
    return {format:"yaml", confidence:"low"};
  },

  label(d){
    const names = {jsonl:"JSONL", json:"JSON", csv:"CSV", xml:"XML", yaml:"YAML"};
    let s = names[d.format] || d.format;
    if(d.format === "csv" && d.delimiter) s = d.delimiter === "\t" ? "TSV" : (s + " ‘" + d.delimiter + "’");
    return s;
  }
};

/* ---------- DW.infer (D11) ---------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

const infer = {
  // Returns the inferred type only. The caller records it *alongside* the literal
  // type, never in place of it — `01234` must stay a str that looks like an int.
  of(s){
    if(typeof s !== "string") return null;
    const t = s.trim();
    if(t === "") return "empty";
    if(t[0] === "{" || t[0] === "["){
      // Embedded JSON is the fixer's whole subject (W6), so it is tested first and
      // at any length — the 64-char shortcut below would hide every long payload.
      return parses(t) ? "json" : "json?";
    }
    if(t.length > 64) return null;
    if(/^[+-]?\d+$/.test(t)) return "int";
    if(/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t) && /[.eE]/.test(t)) return "float";
    if(/^(true|false)$/i.test(t)) return "bool";
    if(/^(null|nil|none|n\/a|na)$/i.test(t)) return "null";
    if(ISO_DATE.test(t)) return "date";
    return null;
  }
};

/* ---------- precision guard (§8 / W15) ---------- */

// Every unquoted numeric literal with more than 15 significant digits is checked
// with String(Number(literal)) === literal. Changes no data; makes silent
// corruption visible. Cheap pre-filter first — most lines never reach the scan.
const LONGDIGITS = /\d{16}/;

function precisionScan(line, out, lineNo){
  if(!LONGDIGITS.test(line)) return;
  let q = false;
  for(let i = 0; i < line.length; i++){
    const c = line[i];
    if(q){
      if(c === "\\"){ i++; continue; }
      if(c === '"') q = false;
      continue;
    }
    if(c === '"'){ q = true; continue; }
    if(c === "-" || (c >= "0" && c <= "9")){
      let j = i;
      if(line[j] === "-") j++;
      const st = j;
      while(j < line.length && /[0-9.eE+-]/.test(line[j])) j++;
      const lit = line.slice(i, j);
      if(j > st && /^-?\d/.test(lit)){
        const digits = lit.replace(/[^0-9]/g, "").replace(/^0+/, "");
        if(digits.length > 15 && out.length < 5000 && String(Number(lit)) !== lit){
          out.push({kind:"precision", line:lineNo,
                    detail:"number " + lit + " cannot be represented exactly — output has " + String(Number(lit))});
        }
      }
      i = j - 1;
    }
  }
}

