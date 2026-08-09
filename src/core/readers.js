/* ---------- DW.readers ---------- */

// Blob.slice + streaming TextDecoder. Hands back whole lines and carries the
// partial tail across chunk boundaries. The full file text is never materialised
// as one JS string (W4), and ctx.bytes stays byte-accurate — which a
// TextDecoderStream cannot give, since it counts characters, and this data is
// routinely Chinese, Thai and Arabic.
async function* chunks(src, ctx){
  if(typeof src === "string"){
    const s = stripBom(src);
    const lines = s.split("\n");
    if(lines.length && lines[lines.length-1] === "") lines.pop();
    for(let i = 0; i < lines.length; i++){
      let l = lines[i];
      if(l.endsWith("\r")) l = l.slice(0, -1);
      yield {line:l, no:i+1};
    }
    if(ctx) ctx.bytes = s.length;
    return;
  }

  const SIZE = 1 << 23;                       // 8 MB per slice
  const dec = new TextDecoder("utf-8");
  let pos = 0, buf = "", no = 0, first = true;

  while(pos < src.size){
    const end = Math.min(pos + SIZE, src.size);
    const ab = await src.slice(pos, end).arrayBuffer();
    pos = end;
    buf += dec.decode(new Uint8Array(ab), {stream:true});
    if(first){ buf = stripBom(buf); first = false; }
    // Cursor rather than re-slicing per line: re-slicing an 8 MB buffer once per
    // line is quadratic and dominates the scan.
    let start = 0, idx;
    while((idx = buf.indexOf("\n", start)) >= 0){
      let line = buf.slice(start, idx);
      if(line.endsWith("\r")) line = line.slice(0, -1);
      yield {line:line, no:++no};
      start = idx + 1;
    }
    buf = buf.slice(start);
    if(ctx) ctx.bytes = pos;
  }
  buf += dec.decode();
  if(first) buf = stripBom(buf);
  if(buf.length){
    if(buf.endsWith("\r")) buf = buf.slice(0, -1);
    yield {line:buf, no:++no};
  }
  if(ctx) ctx.bytes = src.size;
}

// One row of CSV, honouring quotes and "" escapes.
function parseRow(row, delim){
  const out = [];
  let cur = "", q = false;
  for(let i = 0; i < row.length; i++){
    const ch = row[i];
    if(q){
      if(ch === '"'){
        if(row[i+1] === '"'){ cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else {
      if(ch === '"') q = true;
      else if(ch === delim){ out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// A row is complete iff its double-quote count is even.
function balanced(s){
  let n = 0;
  for(let i = 0; i < s.length; i++) if(s[i] === '"') n++;
  return (n % 2) === 0;
}

function jsonErr(e, text){
  const m = /position (\d+)/.exec(e.message);
  if(!m) return e.message;
  const pos = +m[1];
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return e.message.replace(/ in JSON at position \d+.*$/, "") + " (line " + line + ", column " + col + ")";
}

// D4: a top-level array yields its elements; anything else is one record.
function* asRecords(doc){
  if(Array.isArray(doc)){ for(const el of doc) yield {ok:true, value:el}; }
  else yield {ok:true, value:doc};
}

/* --- XML → JS, per D10 --- */
function xmlToJs(el){
  const out = {};
  let hasAttr = false;
  for(let i = 0; i < el.attributes.length; i++){
    out["@" + el.attributes[i].name] = el.attributes[i].value;   // namespace prefix kept verbatim
    hasAttr = true;
  }
  const groups = new Map();
  let text = "";
  for(let n = el.firstChild; n; n = n.nextSibling){
    if(n.nodeType === 1){
      const tag = n.tagName;
      if(!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(n);
    } else if(n.nodeType === 3 || n.nodeType === 4){
      text += n.nodeValue;
    }
  }
  text = text.trim();
  if(!hasAttr && groups.size === 0) return text;   // only text → simply that string
  for(const entry of groups){
    const nodes = entry[1];
    out[entry[0]] = nodes.length > 1 ? nodes.map(xmlToJs) : xmlToJs(nodes[0]);
  }
  if(text) out["#text"] = text;
  return out;
}

const readers = {
  chunks: chunks,

  // Line-oriented: skip-and-report, keep going (D17).
  async *jsonl(src, ctx){
    for await (const c of chunks(src, ctx)){
      const t = c.line.trim();
      if(t === "") continue;
      if(ctx.warn) precisionScan(c.line, ctx.warn, c.no);
      let v;
      try{ v = JSON.parse(t); }
      catch(e){ yield {ok:false, line:c.no, msg:e.message}; continue; }
      yield {ok:true, value:v};
    }
  },

  async *csv(src, ctx){
    const delim = ctx.delimiter || ",";
    let header = null, pending = null, pendingNo = 0;
    for await (const c of chunks(src, ctx)){
      // A quoted field may contain newlines, so a "line" is not always a row.
      const text = pending === null ? c.line : pending + "\n" + c.line;
      if(pending === null) pendingNo = c.no;
      if(!balanced(text)){ pending = text; continue; }
      pending = null;
      if(header === null){
        if(text.trim() === "") continue;
        header = parseRow(text, delim).map(function(h, i){
          const k = h.trim();
          return k === "" ? "__col" + i : k;
        });
        continue;
      }
      if(text === "") continue;
      const fields = parseRow(text, delim);
      const rec = {};
      for(let i = 0; i < fields.length; i++){
        rec[i < header.length ? header[i] : "__col" + i] = fields[i];
      }
      // Ragged rows are a warning, not an error: extra fields become their own
      // low-presence paths, short rows read as reduced presence.
      yield {ok:true, value:rec, ragged: fields.length !== header.length, line:pendingNo};
    }
    if(pending !== null) yield {ok:false, line:pendingNo, msg:"unterminated quoted field at end of file"};
  },

  // Whole-document: no partial recovery exists, so one syntax error means zero records.
  async *json(src, ctx){
    const text = await asText(src);
    let doc;
    try{ doc = JSON.parse(text); }
    catch(e){ yield {ok:false, line:null, msg:jsonErr(e, text)}; return; }
    yield* asRecords(doc);
  },

  async *yaml(src, ctx){
    const text = await asText(src);
    let docs;
    try{ docs = jsyaml.loadAll(text); }
    catch(e){
      const at = e && e.mark ? " (line " + (e.mark.line + 1) + ", column " + (e.mark.column + 1) + ")" : "";
      yield {ok:false, line: e && e.mark ? e.mark.line + 1 : null, msg:(e.reason || e.message) + at};
      return;
    }
    if(docs.length > 1){ for(const d of docs) yield {ok:true, value:d}; return; }
    yield* asRecords(docs.length ? docs[0] : null);
  },

  async *xml(src, ctx){
    const text = await asText(src);
    const p = new DOMParser();
    let doc = p.parseFromString(text, "text/xml");
    if(doc.getElementsByTagName("parsererror").length){
      // XML's stricter rules give the better error; HTML's lenient mode is the net.
      const strict = doc.getElementsByTagName("parsererror")[0].textContent.trim();
      doc = p.parseFromString(text, "text/html");
      if(!doc || !doc.documentElement){ yield {ok:false, line:null, msg:strict}; return; }
    }
    const root = doc.documentElement;
    if(!root){ yield {ok:false, line:null, msg:"no root element"}; return; }
    const kids = [];
    for(let n = root.firstChild; n; n = n.nextSibling) if(n.nodeType === 1) kids.push(n);
    const repeats = kids.length > 1 && kids.every(function(k){ return k.tagName === kids[0].tagName; });
    if(repeats){ for(const k of kids) yield {ok:true, value:xmlToJs(k)}; }
    else yield {ok:true, value:xmlToJs(root)};
  },

  // "data.results[]" -> ["data","results","[]"];  "users.{*}.email" -> ["users","{*}","email"]
  // A key is data, so it may itself hold "." "[" "]" or "\". childPath backslash-
  // escapes those four when it builds a path and this undoes it, which is what makes
  // the round trip lossless. Hand-typed paths carry no backslashes, so unescaping
  // leaves them exactly as typed. Every "]" an escape produced is preceded by its
  // backslash, so an unescaped "[]" pair can only ever be a real array step.
  parsePath(p){
    const s = String(p);
    const parts = [];
    let cur = "";
    for(let i = 0; i < s.length; i++){
      const c = s[i];
      if(c === "\\" && i + 1 < s.length){ cur += c + s[++i]; continue; }
      if(c === "."){ parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    parts.push(cur);
    const steps = [];
    for(const part of parts){
      if(part === "") continue;
      let end = part.length, arrays = 0;
      while(end >= 2 && part[end - 1] === "]" && part[end - 2] === "["){ end -= 2; arrays++; }
      const key = part.slice(0, end).replace(/\\(.)/g, "$1");
      if(key) steps.push(key);
      for(let i = 0; i < arrays; i++) steps.push("[]");
    }
    return steps;
  },

  applyPath(value, steps){
    let cur = [value];
    for(const s of steps){
      const next = [];
      for(const v of cur){
        if(s === "[]"){ if(Array.isArray(v)) for(const el of v) next.push(el); }
        else if(plain(v) && has(v, s)) next.push(v[s]);
      }
      cur = next;
      if(cur.length === 0) break;
    }
    return cur;
  },

  // The single entry point the scan drives. Readers yield their D4 record unit;
  // the optional record path re-roots each.
  async *record(src, format, ctx){
    const base = readers[format];
    if(!base) throw new Error("unsupported format: " + format);
    const steps = (ctx.recordPath && ctx.recordPath.trim()) ? readers.parsePath(ctx.recordPath.trim()) : null;
    ctx.misses = 0;
    for await (const r of base(src, ctx)){
      if(!r.ok || !steps){ yield r; continue; }
      const outs = readers.applyPath(r.value, steps);
      if(outs.length === 0){ ctx.misses++; continue; }
      for(const v of outs) yield {ok:true, value:v, ragged:r.ragged, line:r.line};
    }
  }
};

