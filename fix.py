"""fix — the scripted JSON repairer (Python port of src/core/fix.js, W7/W8).

A tokenizer that tolerates exactly the input json.loads rejects, deterministic
rules expressed as span edits on the original text, and a bounded search in
which a fix is accepted only when the result parses. Every untouched byte is
untouched by construction, which is what makes "preserve spacing and structure
exactly" a guarantee rather than a request.

Three things the v1.1.0 fixer got wrong and this one does not (v1.2.0):

- **The engine is not asked where the parse failed.** ``validate()`` walks the
  token stream and reports the offset itself.
- **Parsing is necessary but not sufficient for acceptance.** A repair can parse
  and still mean something else: ``{"a":1}{"b":2}`` was being "fixed" into one
  object with the key ``a':1}{'b``. Structurally hopeless input is classified and
  refused up front, and string-extending candidates may not swallow unbalanced
  brackets.
- **One pass with a hardcoded rule pairing does not compose.** Rules run to a
  fixpoint and the ambiguous rules are a bounded search over that.

Port notes — where Python and JavaScript disagree, and what was done about it:

- ``json.loads`` accepts ``NaN`` / ``Infinity`` / ``-Infinity``; ``JSON.parse``
  does not. ``parses()`` installs a ``parse_constant`` hook that rejects them, so
  acceptance matches the JS original.
- ``str.strip()`` does not strip U+FEFF and ``re``'s ``\\s`` does not match it,
  while JS's ``trim()`` and ``\\s`` both do. ``trim()`` and ``_JS_WS`` restore
  the JS character set.
- Python's ``$`` matches before a trailing newline; the fence regex uses ``\\Z``.
- ``fix(text)`` and the CLI emit the JSON text alone — repaired when a repair was
  found, the input unchanged when none was. Nothing wraps it. ``repair()`` is
  the same work with the full account of what happened.
- JS strings are UTF-16 code units and Python's are code points, so offsets for
  astral characters differ from the JS build. Every offset here is produced and
  consumed against the same Python string, so the port is internally consistent.
"""

import json
import re

__all__ = ["fix", "repair", "loads", "parses", "trim", "read_text",
           "tokenize", "scan_path", "duplicate_keys", "validate",
           "det_fixpoint", "bracket_candidates", "extend_candidates",
           "prose_candidates", "parse_path", "RULES", "CAUSE_TEXT", "Repair"]

CLOSER = {'"': '"', "'": "'", "“": "”", "”": "”",
          "‘": "’", "’": "’"}
QUOTES = "\"'“”‘’"
PUNCT = "{}[]:,="
INVIS = re.compile("[\ufeff\u00a0\u2007\u202f\u200b\u200c\u200d\u2060]")

# JS `\s` / `String.prototype.trim`: whitespace, line terminators and the BOM.
_JS_WS = (" \t\n\v\f\r\u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff"
          + "".join(chr(c) for c in range(0x2000, 0x200b)))

# Search limits. The budget counts parse attempts, which is what actually costs
# at 500 MB scale; long values get a smaller one because each attempt on a
# 200k-character value is orders of magnitude dearer than on a short one.
DEPTH = 2
BIG = 50000


def budget_for(text):
    return 40 if len(text) > BIG else 400


def trim(text):
    """JS `String.prototype.trim`, which strips U+FEFF where Python does not."""
    return text.strip(_JS_WS)


def _at(text, i):
    """text[i] with JS's out-of-range semantics (None rather than IndexError)."""
    return text[i] if 0 <= i < len(text) else None


def _inner_span(text, tk):
    """Half-open span of a string token's contents. A token ending on a trailing
    backslash runs one past the text; JS ignores the overshoot on read, Python
    raises, so it is clamped here."""
    return tk.s + 1, min((tk.e - 1) if tk.closed else tk.e, len(text))


def _no_constants(token):
    raise ValueError("JSON.parse rejects " + token)


def loads(s):
    """json.loads with JSON.parse's strictness: NaN and Infinity are rejected."""
    return json.loads(s, parse_constant=_no_constants)


def parses(s):
    try:
        loads(s)
        return True
    except Exception:
        return False


class Tok:
    """One token. `t` is s(tring), w(ord), p(unctuation) or c(omment)."""

    __slots__ = ("t", "s", "e", "v", "q", "closed")

    def __init__(self, t, s, e, v=None, q=None, closed=False):
        self.t, self.s, self.e, self.v, self.q, self.closed = t, s, e, v, q, closed

    def __repr__(self):
        return "Tok(%r,%d,%d,%r)" % (self.t, self.s, self.e, self.v)


# Tolerant scanner. Must never throw: it exists to describe malformed text.
def tokenize(text):
    T, n = [], len(text)
    i = 0
    while i < n:
        c = text[i]
        if c in " \t\n\r":
            i += 1
            continue
        if c == "/" and _at(text, i + 1) in ("/", "*"):
            if text[i + 1] == "/":
                j = text.find("\n", i + 2)
                if j < 0:
                    j = n
            else:
                j = text.find("*/", i + 2)
                j = n if j < 0 else j + 2
            T.append(Tok("c", i, j))
            i = j
            continue
        if c in QUOTES:
            close = CLOSER[c]
            j, closed = i + 1, False
            while j < n:
                d = text[j]
                if d == "\\":
                    j += 2
                    continue
                if d == close:
                    closed = True
                    j += 1
                    break
                j += 1
            T.append(Tok("s", i, j, q=c, closed=closed))
            i = j
            continue
        if c in PUNCT:
            T.append(Tok("p", i, i + 1, v=c))
            i += 1
            continue
        j = i
        while (j < n and text[j] not in PUNCT and text[j] not in QUOTES and text[j] != "\n"
               and not (text[j] == "/" and _at(text, j + 1) in ("/", "*"))):
            j += 1
        e = j
        while e > i and text[e - 1] in _JS_WS:
            e -= 1
        if e > i:
            T.append(Tok("w", i, e, v=text[i:e]))
        i = j if j > i else i + 1
    return T


def apply_edits(text, edits):
    """Edits are (start, end, replacement) spans over `text`."""
    if not edits:
        return text
    edits = sorted(edits, key=lambda ed: ed[0])
    out, pos = [], 0
    for s, e, t in edits:
        if s < pos:
            continue                                  # overlapping edits: first wins
        out.append(text[pos:s])
        out.append(t)
        pos = e
    out.append(text[pos:])
    return "".join(out)


def quote_str(inner):
    return json.dumps(inner, ensure_ascii=False)


_ESC = re.compile(r"\\(.)")
_ESC_MAP = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'"}


def _unescape(m):
    return _ESC_MAP.get(m.group(1), m.group(0))


def inner_of(text, tk):
    """Inner text of a string token, with its own escapes made literal enough to
    re-quote. Escaped delimiters become the plain character."""
    raw = text[tk.s + 1:(tk.e - 1) if tk.closed else tk.e]
    return _ESC.sub(_unescape, raw)


NUMERIC = re.compile(r"^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$")
LITERAL = {"true", "false", "null"}
PY = {"True": "true", "False": "false", "None": "null", "undefined": "null",
      "NaN": "null", "TRUE": "true", "FALSE": "false", "NULL": "null",
      "Null": "null", "nil": "null", "Infinity": "null", "-Infinity": "null",
      "inf": "null", "-inf": "null"}


def _non_comment(T):
    return [t for t in T if t.t != "c"]


def _scalar_word(v):
    """A bare word that could stand as a JSON scalar once the deterministic rules
    have had their turn. Used only to tell broken JSON from prose."""
    return bool(NUMERIC.match(v)) or v in LITERAL or v in PY


# ==========================================================================
# validate — where the parse breaks, and why, without asking the engine.
# Returns (pos, cause). `cause` is None when the token stream walks as valid
# JSON structure; that is not the same as parsing (raw control characters and
# bad escapes walk fine and still fail json.loads), so json.loads remains the
# only thing that can accept a repair. This exists to aim the search and to
# classify residue.
# ==========================================================================

def validate(text):
    T = _non_comment(tokenize(text))
    if not T:
        return (0, "not json")

    # A root bare word that is not a scalar is prose — but only when there is no
    # object or array anywhere in the value. A fenced block opens on ```json and a
    # model's preamble opens on "Here is the JSON:"; both are damaged JSON with
    # something wrapped around it, and both have a `{` further in.
    root_is_word = T[0].t == "w" and not _scalar_word(T[0].v)
    if root_is_word:
        structural = any(t.t == "p" and (t.v == "{" or t.v == "[") for t in T)
        if not structural:
            return (T[0].s, "not json")

    stack = []
    st = "value"
    for t in T:
        if t.t == "s" and not t.closed:
            return (t.s, "truncated")
        top = stack[-1] if stack else None

        if st == "value":
            if t.t == "p" and t.v == "[":
                stack.append("arr")
                st = "value"
                continue
            if t.t == "p" and t.v == "{":
                stack.append("obj")
                st = "key"
                continue
            if t.t == "p" and t.v == "]" and top == "arr":
                stack.pop()
                st = "comma"
                continue
            if t.t == "s" or t.t == "w":
                st = "comma"
                continue
            return (t.s, "unexpected")
        if st == "key":
            if t.t == "p" and t.v == "}" and top == "obj":
                stack.pop()
                st = "comma"
                continue
            if t.t == "s" or t.t == "w":
                st = "colon"
                continue
            return (t.s, "unexpected")
        if st == "colon":
            if t.t == "p" and (t.v == ":" or t.v == "="):
                st = "value"
                continue
            return (t.s, "unexpected")
        # st == "comma": a value just completed
        if t.t == "p" and t.v == ",":
            st = "key" if top == "obj" else "value"
            continue
        if t.t == "p" and t.v == "}" and top == "obj":
            stack.pop()
            st = "comma"
            continue
        if t.t == "p" and t.v == "]" and top == "arr":
            stack.pop()
            st = "comma"
            continue
        if not stack:
            # The root value is complete and there is more text. Another root is
            # the spec's leave-unchanged case; a trailing bare word is a model
            # signing off. ...but only if what completed was a real root. A
            # leading bare word is a fence or a preamble, and the object after it
            # is the payload, not a second root.
            more = ((t.t == "p" and (t.v == "{" or t.v == "["))
                    or t.t == "s" or (t.t == "w" and _scalar_word(t.v)))
            return (t.s, "concatenated-roots" if (more and not root_is_word) else "unexpected")
        return (t.s, "unexpected")

    if stack or st != "comma":
        return (len(text), "truncated")
    return (-1, None)


CAUSE_TEXT = {
    "truncated":          "value is cut off — the JSON ends mid-structure",
    "concatenated-roots": "two or more root values concatenated — left unchanged by design",
    "not json":           "not JSON — no object, array or scalar at the root",
    "unexpected":         "structure does not parse and no candidate repair did either",
    "empty value":        "empty value",
    "not a string":       "not a string",
}


# ==========================================================================
# The deterministic rules. Each is a pure text -> text|None; None means "did not
# fire". Every one opens with a cheap substring guard, because they run to a
# fixpoint and tokenising a 200k-character value thirteen times per pass for
# nothing is the difference between instant and not.
# ==========================================================================

def rule_invisible(text):
    """11 · BOM, NBSP, invisible whitespace — outside strings only, where they are
    punctuation-shaped rather than content."""
    if not INVIS.search(text):
        return None
    mask = bytearray(len(text))
    for t in tokenize(text):
        if t.t == "s":
            for i in range(t.s, min(t.e, len(text))):
                mask[i] = 1
    out, hit = [], False
    for i, c in enumerate(text):
        if not mask[i] and INVIS.match(c):
            hit = True
            out.append("" if c == "\ufeff" else " ")
            continue
        out.append(c)
    return "".join(out) if hit else None


_FENCE_FULL = re.compile(r"^\s*```[A-Za-z0-9_+-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```\s*\Z")
_FENCE_OPEN = re.compile(r"^\s*```[A-Za-z0-9_+-]*[ \t]*\r?\n?")


def rule_fences(text):
    """13 · markdown code fences. A model told to emit JSON emits a fenced block
    often enough that this is a rule and not a curiosity."""
    if "```" not in text:
        return None
    m = _FENCE_FULL.match(text)
    if m:
        return trim(m.group(1))
    open_m = _FENCE_OPEN.match(text)                  # opened, never closed
    return trim(text[open_m.end():]) if open_m else None


def rule_comments(text):
    """10 · // and /* */ comments"""
    if "//" not in text and "/*" not in text:
        return None
    edits = [(t.s, t.e, "") for t in tokenize(text) if t.t == "c"]
    return apply_edits(text, edits) if edits else None


def rule_trailing_comma(text):
    """4 · trailing comma before } or ]"""
    if "," not in text:
        return None
    T = _non_comment(tokenize(text))
    edits = []
    for i in range(len(T) - 1):
        if (T[i].t == "p" and T[i].v == "," and T[i + 1].t == "p"
                and (T[i + 1].v == "}" or T[i + 1].v == "]")):
            edits.append((T[i].s, T[i].e, ""))
    return apply_edits(text, edits) if edits else None


def rule_python_literals(text):
    """9 · True / False / None / undefined / NaN / Infinity -> JSON literals
    (outside strings by construction: only bare-word tokens are considered)."""
    edits = [(t.s, t.e, PY[t.v]) for t in tokenize(text) if t.t == "w" and t.v in PY]
    return apply_edits(text, edits) if edits else None


def rule_equals_colon(text):
    """8 · = used where : belongs"""
    if "=" not in text:
        return None
    edits = [(t.s, t.e, ":") for t in tokenize(text) if t.t == "p" and t.v == "="]
    return apply_edits(text, edits) if edits else None


_CURLY = re.compile("[“”‘’]")


def rule_smart_quotes(text):
    """2 · smart/curly quotes -> straight, *where delimiting*. Positional by
    construction: the tokenizer only opens a string on a curly quote at a token
    boundary, so a curly quote inside a double-quoted value is never touched."""
    if not _CURLY.search(text):
        return None
    edits = [(t.s, t.e, quote_str(inner_of(text, t)))
             for t in tokenize(text) if t.t == "s" and t.q != '"' and t.q != "'"]
    return apply_edits(text, edits) if edits else None


def rule_single_quotes(text):
    """1 · single -> double quotes on keys and values"""
    if "'" not in text:
        return None
    edits = [(t.s, t.e, quote_str(inner_of(text, t)))
             for t in tokenize(text) if t.t == "s" and t.q == "'"]
    return apply_edits(text, edits) if edits else None


def rule_unquoted_keys(text):
    """6 · unquoted keys"""
    T = _non_comment(tokenize(text))
    edits = []
    for i in range(len(T) - 1):
        if T[i].t == "w" and T[i + 1].t == "p" and T[i + 1].v == ":":
            edits.append((T[i].s, T[i].e, quote_str(T[i].v)))
    return apply_edits(text, edits) if edits else None


def rule_bare_values(text):
    """7 · unquoted bare-word values that are not number / bool / null. Never at
    the root: a lone bare word there is prose, and quoting it would turn "sorry, I
    can't help with that" into a successful parse."""
    T = _non_comment(tokenize(text))
    if len(T) == 1 and T[0].t == "w":
        return None
    edits = []
    for i, t in enumerate(T):
        if t.t != "w":
            continue
        nxt = T[i + 1] if i + 1 < len(T) else None
        prv = T[i - 1] if i > 0 else None
        if nxt and nxt.t == "p" and nxt.v == ":":
            continue                                  # it is a key
        if NUMERIC.match(t.v) or t.v in LITERAL:
            continue
        # A bare run wedged directly against a string on either side is not a bare
        # value — it is text that fell out of a string whose quoting went wrong.
        # Leave it for the extend-string search, which can actually read it.
        if prv and prv.t == "s" and prv.e == t.s:
            continue
        if nxt and nxt.t == "s" and nxt.s == t.e:
            continue
        edits.append((t.s, t.e, quote_str(t.v)))
    return apply_edits(text, edits) if edits else None


_CTRL = re.compile("[\u0000-\u001f]")


def rule_control_chars(text):
    """14 · raw control characters inside strings. A model emitting multi-line
    reasoning into a JSON string produces these constantly."""
    if not _CTRL.search(text):
        return None
    edits = []
    for t in tokenize(text):
        if t.t != "s":
            continue
        s, e = _inner_span(text, t)
        out, hit = [], False
        i = s
        while i < e:
            c = text[i]
            if c == "\\":
                out.append(c + (_at(text, i + 1) or ""))
                i += 2
                continue
            cc = ord(c)
            if cc < 0x20:
                hit = True
                out.append("\\n" if cc == 10 else "\\t" if cc == 9 else "\\r" if cc == 13
                           else "\\u%04x" % cc)
            else:
                out.append(c)
            i += 1
        if hit:
            edits.append((s, e, "".join(out)))
    return apply_edits(text, edits) if edits else None


_HEX4 = re.compile(r"^[0-9a-fA-F]{4}")


def rule_bad_escapes(text):
    """15 · invalid escapes inside double-quoted strings. All-or-nothing per
    string: a value containing `\\d` was not written with JSON escaping in mind, so
    its `\\b` is a Windows path separator and not a backspace. Runs on `"` strings
    only — single-quoted ones are re-emitted through json.dumps by rule 1, which
    produces valid escapes by construction."""
    if "\\" not in text:
        return None
    VALID = '"\\/bfnrtu'
    edits = []
    for t in tokenize(text):
        if t.t != "s" or t.q != '"':
            continue
        s, e = _inner_span(text, t)
        bad = False
        i = s
        while i < e:
            if text[i] != "\\":
                i += 1
                continue
            n = _at(text, i + 1)
            if n is None or n not in VALID:
                bad = True
                break
            if n == "u" and not _HEX4.match(text[i + 2:i + 6]):
                bad = True
                break
            i += 2
        if not bad:
            continue
        out = []
        i = s
        while i < e:
            if text[i] == "\\" and _at(text, i + 1) == "\\":
                out.append("\\\\")
                i += 2
                continue
            out.append("\\\\" if text[i] == "\\" else text[i])
            i += 1
        edits.append((s, e, "".join(out)))
    return apply_edits(text, edits) if edits else None


def rule_missing_commas(text):
    """5 · missing comma *where unambiguous* — which is exactly a tokenizer
    boundary check: a completed value followed directly by the start of another."""
    T = _non_comment(tokenize(text))

    def ends(t):
        return t.t == "s" or t.t == "w" or (t.t == "p" and (t.v == "}" or t.v == "]"))

    def opens(t):
        return t.t == "s" or t.t == "w" or (t.t == "p" and (t.v == "{" or t.v == "["))

    edits = []
    for i in range(len(T) - 1):
        a, b = T[i], T[i + 1]
        if not ends(a) or not opens(b):
            continue
        # A string and a bare word with nothing at all between them is not a
        # missing comma — it is a string that lost its closing quote. Inserting
        # here would destroy the reading the extend-string search is about to
        # find, so leave it, exactly as bare_values does for the same shape.
        if a.e == b.s and ((a.t == "s" and b.t == "w") or (a.t == "w" and b.t == "s")):
            continue
        edits.append((a.e, a.e, ","))
    return apply_edits(text, edits) if edits else None


RULES = {
    "fences": rule_fences,
    "invisible": rule_invisible,
    "comments": rule_comments,
    "controlChars": rule_control_chars,
    "trailingComma": rule_trailing_comma,
    "pythonLiterals": rule_python_literals,
    "equalsColon": rule_equals_colon,
    "smartQuotes": rule_smart_quotes,
    "singleQuotes": rule_single_quotes,
    "badEscapes": rule_bad_escapes,
    "unquotedKeys": rule_unquoted_keys,
    "bareValues": rule_bare_values,
    "missingCommas": rule_missing_commas,
}

# Order matters: shells off (fences), then lexical normalisation, then the rules
# that read structure. `bareValues` and `missingCommas` go last because they are
# the two that will happily act on text the earlier rules would have re-quoted.
ORDER = ["fences", "invisible", "comments", "controlChars", "trailingComma",
         "pythonLiterals", "equalsColon", "smartQuotes", "singleQuotes",
         "badEscapes", "unquotedKeys", "bareValues", "missingCommas"]


def det_fixpoint(text):
    """Deterministic rules to a fixpoint. Returns as soon as the text parses, so
    the common case pays for one pass and not three."""
    cur = text
    for _pass in range(3):
        fired = False
        for name in ORDER:
            nxt = RULES[name](cur)
            if nxt is None or nxt == cur:
                continue
            cur = nxt
            fired = True
            if parses(cur):
                return cur
        if not fired:
            break
    return cur


# ==========================================================================
# The ambiguous rules. Each yields candidate readings rather than an answer;
# the search decides, and only a successful json.loads accepts.
# ==========================================================================

def bracket_candidates(text):
    """3 · extra / duplicate / stray brackets. The outer pair goes first because
    wrapping an array in braces — `{ [ ... ] }` — is the single most common shape
    a model produces, and it needs two deletions that no single-deletion search
    can reach."""
    out = []
    # Peel the outer pair first, and do it on the characters rather than the
    # tokens: an unterminated quote further in swallows the closing brackets into
    # a string token, so the token stream cannot see a pair that is plainly there
    # in the text. `{ [ ... ] }` with a broken string inside is exactly that case.
    t = trim(text)
    if len(t) > 2 and t[0] in "{[" and t[-1] in "}]":
        out.append((t[1:-1], "bracketPair"))

    T = _non_comment(tokenize(text))
    brackets = [tk for tk in T if tk.t == "p" and tk.v in "{}[]"]
    if len(brackets) < 2:
        return out

    def score(idx):
        tk = brackets[idx]
        prev = brackets[idx - 1] if idx > 0 else None
        nxt = brackets[idx + 1] if idx + 1 < len(brackets) else None
        if (prev and prev.v == tk.v and prev.e == tk.s) or (nxt and nxt.v == tk.v and nxt.e == tk.s):
            return 0
        if idx == 0 or idx == len(brackets) - 1:
            return 1
        return 2

    order = sorted(range(len(brackets)), key=lambda i: (score(i), i))[:30]
    for idx in order:
        tk = brackets[idx]
        out.append((text[:tk.s] + text[tk.e:], "strayBracket"))
    return out


def prose_candidates(text):
    """16 · prose around the payload — "Here is the JSON: {...}", "{...} Hope this
    helps!". Takes the span from the first opening bracket to the last closing one."""
    T = _non_comment(tokenize(text))
    first = last = -1
    for i, t in enumerate(T):
        if t.t == "p" and (t.v == "{" or t.v == "["):
            first = i
            break
    for i in range(len(T) - 1, -1, -1):
        if T[i].t == "p" and (T[i].v == "}" or T[i].v == "]"):
            last = i
            break
    if first < 0 or last <= first:
        return []
    if T[first].s == 0 and T[last].e == len(text):
        return []                                     # nothing around it
    return [(text[T[first].s:T[last].e], "proseTrim")]


def balanced_span(text, s, e):
    """Brackets swallowed by an extended string must balance. This is what stops
    `{"a":1}{"b":2}` becoming one object keyed `a':1}{'b` — a repair that parses
    and is nonsense. Commas and colons are not counted: prose is full of them."""
    depth = 0
    for i in range(s, e):
        c = text[i]
        if c == "{" or c == "[":
            depth += 1
        elif c == "}" or c == "]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def extend_candidates(text, q):
    """1-edge / 12 · a string that ran long: an unescaped `"` inside a
    double-quoted value, or an apostrophe inside a single-quoted one. Same search
    either way — re-close the string at a later delimiter and re-emit it through
    json.dumps, which escapes whatever was interior. Lossless: the old rule
    substituted `'` for interior `"` and changed the content."""
    if q not in text:
        return []
    pos, _cause = validate(text)
    if pos < 0:
        pos = len(text)
    heads = [t for t in tokenize(text) if t.t == "s" and t.q == q and t.s <= pos]
    out = []
    for tk in reversed(heads[-3:]):
        if not tk.closed:
            continue
        n = 0
        j = tk.e
        while j < len(text) and n < 12:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] != q:
                j += 1
                continue
            n += 1
            if not balanced_span(text, tk.e, j):
                j += 1
                continue
            inner = _ESC.sub(_unescape, text[tk.s + 1:j])
            out.append((text[:tk.s] + quote_str(inner) + text[j + 1:], "extendString"))
            j += 1
    return out


def ambiguous_candidates(text):
    return (prose_candidates(text)
            + extend_candidates(text, '"')
            + extend_candidates(text, "'")
            + bracket_candidates(text))


# --- duplicate keys: detected, never repaired (json.loads keeps the last
#     occurrence and destroys the evidence before any consumer sees it) ---

def duplicate_keys(text):
    T = _non_comment(tokenize(text))
    stack, dups = [], []
    for i, t in enumerate(T):
        if t.t == "p" and t.v == "{":
            stack.append(set())
            continue
        if t.t == "p" and (t.v == "}" or t.v == "]"):
            if t.v == "}" and stack:
                stack.pop()
            continue
        if t.t == "p" and t.v == "[":
            stack.append(None)
            continue
        nxt = T[i + 1] if i + 1 < len(T) else None
        if (t.t == "s" or t.t == "w") and nxt and nxt.t == "p" and nxt.v == ":":
            top = stack[-1] if stack else None
            if top is None:
                continue
            name = text[t.s + 1:(t.e - 1) if t.closed else t.e] if t.t == "s" else t.v
            if name in top:
                dups.append(name)
            else:
                top.add(name)
    return dups


# --- how many characters an accepted fix moved ---

def changed_chars(a, b):
    p = 0
    m = min(len(a), len(b))
    while p < m and a[p] == b[p]:
        p += 1
    s = 0
    while s < m - p and a[len(a) - 1 - s] == b[len(b) - 1 - s]:
        s += 1
    return max(len(a) - p - s, len(b) - p - s)


# ==========================================================================
# The verify-loop (W8): deterministic rules to a fixpoint, then a bounded
# search over the ambiguous ones, re-running the deterministic rules after
# every candidate so that a fence, a brace pair and a quote conversion compose.
# ==========================================================================

class Repair:
    """The result of one repair attempt.

    `ok` — the value now parses. `out` — the repaired text, or the input
    byte-identical when it does not. `rule` — the trail of ambiguous rules that
    got there, None for a clean parse or a purely deterministic fix. `clean` —
    the input already parsed and nothing was changed.
    """

    __slots__ = ("ok", "out", "rule", "changed", "reason", "cause", "clean")

    def __init__(self, ok, out, rule=None, changed=0, reason=None, cause=None, clean=False):
        self.ok, self.out, self.rule = ok, out, rule
        self.changed, self.reason, self.cause, self.clean = changed, reason, cause, clean

    def __repr__(self):
        return ("Repair(ok=%r, rule=%r, changed=%d, cause=%r)"
                % (self.ok, self.rule, self.changed, self.cause))


def _search(text, depth, found, budget, trail):
    if budget[0] <= 0:
        return
    budget[0] -= 1
    cur = det_fixpoint(text)
    if parses(cur):
        found.append((cur, trail or "deterministic"))
        return
    if depth <= 0:
        return
    # Candidates come off the *untouched* text as well as the rewritten one. A
    # deterministic rule that fired without fixing anything otherwise hides the
    # reading that would have worked: `{'a': 'it's fine'}` has its quotes
    # converted by rule 1 into a shape where the apostrophe is no longer
    # recoverable, and the original is the only text the search can still read.
    bases = [cur] if cur == text else [text, cur]
    for base in bases:
        for cand, name in ambiguous_candidates(base):
            if budget[0] <= 0 or len(found) >= 4:
                return
            _search(cand, depth - 1, found, budget, trail + "+" + name if trail else name)


def repair(text):
    if not isinstance(text, str):
        return Repair(False, text, reason="not a string", cause="not a string")
    trimmed = trim(text)
    if trimmed == "":
        return Repair(False, text, reason="empty value", cause="empty value")
    if parses(trimmed):
        return Repair(True, trimmed, clean=True)

    # Structurally hopeless or deliberately out of scope: say so instead of
    # searching for a reading that would have to invent data to exist.
    _pos, cause = validate(trimmed)
    if cause in ("truncated", "concatenated-roots", "not json"):
        return Repair(False, text, reason=CAUSE_TEXT[cause], cause=cause)

    found = []
    _search(trimmed, DEPTH, found, [budget_for(trimmed)], None)
    if found:
        # Every candidate here has already parsed; the tie-break is fewest
        # characters changed, which is what keeps a big rewrite from beating a
        # small correct one.
        found.sort(key=lambda f: changed_chars(trimmed, f[0]))
        out, rule = found[0]
        return Repair(True, out, rule=rule, changed=changed_chars(trimmed, out))

    # Exhausted: hand back the input byte-identical, with the cause.
    cause = cause or "unexpected"
    return Repair(False, text, reason=CAUSE_TEXT.get(cause, cause), cause=cause)


# ==========================================================================
# Path navigation (ported from readers.parsePath / skeleton.valueRefs) and the
# per-path scan built on it.
# ==========================================================================

def parse_path(p):
    """"data.results[]" -> ["data","results","[]"];  "users.{*}.email" ->
    ["users","{*}","email"]. A key is data, so it may itself hold "." "[" "]" or
    "\\". child_path backslash-escapes those four when it builds a path and this
    undoes it, which is what makes the round trip lossless."""
    s = str(p)
    parts, cur = [], []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            cur.append(c + s[i + 1])
            i += 2
            continue
        if c == ".":
            parts.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(c)
        i += 1
    parts.append("".join(cur))

    steps = []
    for part in parts:
        if part == "":
            continue
        end, arrays = len(part), 0
        while end >= 2 and part[end - 1] == "]" and part[end - 2] == "[":
            end -= 2
            arrays += 1
        key = _ESC.sub(lambda m: m.group(1), part[:end])
        if key:
            steps.append(key)
        steps.extend(["[]"] * arrays)
    return steps


def _refs_at(v, steps, i, out):
    s, last = steps[i], i == len(steps) - 1
    if s == "[]":
        if not isinstance(v, list):
            return
        for k in range(len(v)):
            if last:
                out.append((v, k))
            else:
                _refs_at(v[k], steps, i + 1, out)
        return
    if s == "{*}":
        if not isinstance(v, dict):
            return
        for k in list(v):
            if last:
                out.append((v, k))
            else:
                _refs_at(v[k], steps, i + 1, out)
        return
    if not isinstance(v, dict) or s not in v:
        return
    if last:
        out.append((v, s))
    else:
        _refs_at(v[s], steps, i + 1, out)


def value_refs(record, steps):
    """Every reference to a value at `path` inside one record, as (container, key)
    pairs so the value can be both read and written (the residue merge writes)."""
    out = []
    if steps:
        _refs_at(record, steps, 0, out)
    return out


def scan_path(records, path):
    """Runs repair across one path's values. Populates the "941/1000 parse · 59
    fail" readout, the residue list, the per-cause tally and the duplicate-key
    warnings."""
    steps = parse_path(path)
    out = {"total": 0, "parsed": 0, "repaired": 0, "residue": [], "dups": [],
           "values": [], "causes": {}}
    for i, record in enumerate(records):
        refs = value_refs(record, steps)
        for o, (container, key) in enumerate(refs):
            raw = container[key]
            if not isinstance(raw, str):
                continue
            out["total"] += 1
            r = repair(raw)
            if r.ok:
                if r.clean:
                    out["parsed"] += 1
                else:
                    out["repaired"] += 1
                out["values"].append(loads(r.out))
                if len(out["dups"]) < 200:
                    for d in duplicate_keys(r.out):
                        out["dups"].append({"i": i, "o": o, "key": d})
            else:
                out["causes"][r.cause] = out["causes"].get(r.cause, 0) + 1
                if len(out["residue"]) < 5000:
                    out["residue"].append({"i": i, "o": o, "path": path,
                                           "reason": r.reason, "cause": r.cause,
                                           "raw": raw})
    return out


# ==========================================================================
# Agent entry point: text in, JSON text out — nothing else.
# ==========================================================================

def fix(text):
    """Repair one value and return the JSON text, and only the JSON text.

    Repaired when a repair was found, otherwise the input exactly as given —
    so the output is always something to hand to the next stage, and a value
    that could not be repaired is passed through rather than lost. Whether a
    repair happened is deliberately not reported here; ask `verify()`, which
    is the gate, or `repair()`, which returns the full account (rule, chars
    changed, cause) for anyone who needs it.
    """
    return repair(text).out


def read_text(name):
    """File contents, or standard input when `name` is "-". Reads file
    descriptor 0 directly, so neither module needs `sys` to accept a pipe."""
    return open(0 if name == "-" else name, encoding="utf-8").read()


def _main(argv=None):
    import argparse

    ap = argparse.ArgumentParser(
        description="Repair one JSON value. Reads stdin unless a file is given; "
                    "writes the repaired JSON to stdout, or the input unchanged "
                    "when no repair was found.")
    ap.add_argument("file", nargs="?", default="-", help="input file, or - for stdin")
    args = ap.parse_args(argv)

    try:
        text = read_text(args.file)
    except OSError as e:
        # Nothing readable means nothing to emit. Keep stdout strictly JSON and
        # put the complaint on stderr, which SystemExit does without `sys`.
        raise SystemExit("fix: %s" % e)

    print(fix(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
