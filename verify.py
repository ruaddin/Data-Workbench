#!/usr/bin/env python3
"""verify — does this JSON parse, and if not, where does it break?

Runs values through `fix.repair` and reports one of three outcomes per value:

    ok      parses as-is
    fixed   did not parse, but a repair was found (names the rules, counts the
            characters moved)
    FAIL    does not parse and no candidate repair did either — reports the
            cause and the line:col where the token stream breaks

Duplicate keys are reported as a warning even on values that parse: json.loads
keeps the last occurrence, so the file is lossy in a way a plain parse check
cannot see.

Usage:
    python3 verify.py data.json                 # one JSON document
    python3 verify.py data.jsonl --jsonl        # one document per line
    python3 verify.py recs.jsonl --jsonl --path payload.body
    cat data.json | python3 verify.py            # stdin is the default

    cat candidate.json | python3 verify.py --json    # machine-readable

Exit status in the human modes is 0 when every value parses or is repairable,
1 otherwise. `--json` always exits 0 on a successful run and puts the verdict
in the payload's `ok`, so an agent runner does not read "this JSON is invalid"
— a real answer — as "the tool crashed". Bad arguments or an unreadable file
still exit 2.

`--json` is the strict gate: unlike the human modes it does not attempt a
repair, so `ok` means the text parses exactly as handed over.
"""

import argparse
import json

import fix


class Unreadable(Exception):
    """Input that could not be read, or whose outer container does not parse.
    That is a failed run, not a verdict about a value, so it is kept apart from
    the ok/fail tally."""


def break_at(text):
    """Where the token stream breaks, as an offset into `text` itself.
    `fix.validate` reads trimmed text, so its offset is short by whatever
    leading whitespace was stripped; that is added back here. Returns
    (offset, cause), offset -1 when the structure walks clean."""
    trimmed = fix.trim(text)
    pos, cause = fix.validate(trimmed)
    if pos < 0:
        return -1, cause
    return pos + (len(text) - len(text.lstrip(fix._JS_WS))), cause


def line_col(text, pos):
    """1-based line and column for a character offset."""
    pos = max(0, min(pos, len(text)))
    return (text.count("\n", 0, pos) + 1,
            pos - (text.rfind("\n", 0, pos) + 1) + 1)


def position(text, pos):
    """A ":line:col" suffix for a character offset. A value that is itself one
    line gets ":col" alone — its line number is already in the label
    (`data.jsonl:3`), and repeating a line of 1 there reads as an offset."""
    line, col = line_col(text, pos)
    return ":%d" % col if "\n" not in text.rstrip("\n") else ":%d:%d" % (line, col)


def excerpt(text, pos, width=48):
    """The text around `pos`, on one line."""
    start = max(0, pos - width // 2)
    end = min(len(text), start + width)
    snippet = text[start:end].replace("\n", "\\n").replace("\t", "\\t")
    return ("…" if start else "") + snippet + ("…" if end < len(text) else "")


def check(text, label):
    """Verify one value. Returns (status, report lines) where status is
    "ok", "fixed" or "fail"."""
    r = fix.repair(text)

    if not r.ok:
        pos, _cause = break_at(text)
        if pos < 0:
            return "fail", ["FAIL    %s — %s" % (label, r.reason)]
        return "fail", ["FAIL    %s%s — %s" % (label, position(text, pos), r.reason),
                        "        %s" % excerpt(text, pos)]

    if r.clean:
        status, lines = "ok", ["ok      %s — parses" % label]
    else:
        status = "fixed"
        lines = ["fixed   %s — repaired via %s (%d char%s changed)"
                 % (label, r.rule, r.changed, "" if r.changed == 1 else "s")]

    dups = fix.duplicate_keys(r.out)
    if dups:
        lines.append("        warn: duplicate key%s %s — json.loads keeps the last"
                     % ("" if len(dups) == 1 else "s",
                        ", ".join(repr(d) for d in sorted(set(dups)))))
    return status, lines


# `unexpected` in fix.CAUSE_TEXT reads "...and no candidate repair did either",
# which is a claim about the repairer. Verifying makes no such attempt.
_REASON = dict(fix.CAUSE_TEXT, unexpected="does not parse as JSON")


def verify(text):
    """Check one value, without repairing it. Returns a JSON-serialisable dict:

        ok              the text parses exactly as given
        value           the parsed value, or None
        duplicate_keys  keys that appear twice in the same object — reported
                        even when ok, because the parse silently keeps the last
                        one and a plain parse check cannot see the loss
        cause           classification of the break, None when ok
        reason          that cause in a sentence
        error           the parser's own message, verbatim
        position        {offset, line, column} of the break, None when the token
                        stream walks clean (bad escapes and raw control
                        characters parse-fail without a structural break)
        excerpt         the text around the break

    This is the gate, so it deliberately does not repair: `ok` means the text
    in hand is already valid JSON. Feed a failure back through fix() to retry.
    """
    out = {"ok": False, "value": None, "duplicate_keys": [], "cause": None,
           "reason": None, "error": None, "position": None, "excerpt": None}

    if not isinstance(text, str):
        out["cause"] = "not a string"
        out["reason"] = _REASON["not a string"]
        return out

    trimmed = fix.trim(text)
    if trimmed == "":
        out["cause"] = "empty value"
        out["reason"] = _REASON["empty value"]
        return out

    try:
        out["value"] = fix.loads(trimmed)
    except ValueError as e:
        out["error"] = str(e)
    else:
        out["ok"] = True
        out["duplicate_keys"] = sorted(set(fix.duplicate_keys(trimmed)))
        return out

    pos, cause = break_at(text)
    out["cause"] = cause or "unexpected"
    out["reason"] = _REASON.get(out["cause"], out["cause"])
    if pos >= 0:
        line, col = line_col(text, pos)
        out["position"] = {"offset": pos, "line": line, "column": col}
        out["excerpt"] = excerpt(text, pos)
    return out


def load_records(text, jsonl, label):
    """The outer container, as a list of records to walk with --path."""
    if jsonl:
        records = []
        for n, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except ValueError as e:
                raise Unreadable("%s:%d: outer line does not parse: %s" % (label, n, e))
        return records
    try:
        value = json.loads(text)
    except ValueError as e:
        raise Unreadable("%s: outer document does not parse: %s" % (label, e))
    return value if isinstance(value, list) else [value]


def values_of(text, label, args):
    """Every (label, string) pair this input asks us to verify."""
    if args.path:
        steps = fix.parse_path(args.path)
        for i, record in enumerate(load_records(text, args.jsonl, label)):
            refs = fix.value_refs(record, steps)
            for o, (container, key) in enumerate(refs):
                raw = container[key]
                if not isinstance(raw, str):
                    continue
                where = "%s[%d].%s" % (label, i, args.path)
                yield (where + ("#%d" % o if len(refs) > 1 else ""), raw)
    elif args.jsonl:
        for n, line in enumerate(text.splitlines(), 1):
            if line.strip():
                yield ("%s:%d" % (label, n), line)
    else:
        yield (label, text)


def report_unreadable(message, as_json):
    """Report a failed run on stdout — the only output channel either script
    uses — and give back the exit status."""
    if as_json:
        print(json.dumps({"ok": False, "value": None, "duplicate_keys": [],
                          "cause": "unreadable input", "reason": message,
                          "error": message, "position": None, "excerpt": None},
                         ensure_ascii=False))
    else:
        print("verify: %s" % message)
    return 2


def main():
    ap = argparse.ArgumentParser(
        description="Verify that JSON parses, and report where it does not.")
    ap.add_argument("files", nargs="*", default=["-"],
                    help="files to check, or - for stdin (the default)")
    ap.add_argument("--jsonl", action="store_true",
                    help="treat each line as its own document")
    ap.add_argument("--path",
                    help="verify the JSON string held at this path inside each record")
    ap.add_argument("-q", "--quiet", action="store_true",
                    help="only report failures and the summary")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable: one JSON object per value, one per line, "
                         "no summary. Does not repair — ok means the text already parses")
    args = ap.parse_args()

    tally = {"ok": 0, "fixed": 0, "fail": 0}

    for name in args.files:
        label = "<stdin>" if name == "-" else name
        try:
            text = fix.read_text(name)
            for where, raw in values_of(text, label, args):
                if args.json:
                    result = verify(raw)
                    tally["ok" if result["ok"] else "fail"] += 1
                    print(json.dumps(result, ensure_ascii=False))
                    continue
                status, lines = check(raw, where)
                tally[status] += 1
                if status == "fail" or not args.quiet:
                    print("\n".join(lines))
        except (OSError, Unreadable) as e:
            return report_unreadable(str(e), args.json)

    if args.json:
        return 0

    total = sum(tally.values())
    print("\n%d value%s · %d parse · %d repaired · %d failed"
          % (total, "" if total == 1 else "s",
             tally["ok"], tally["fixed"], tally["fail"]))
    return 1 if tally["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())


path = "/Users/bytedance/Documents/Bad case review viewer/secret/phase 4/phase4_step5_rubrics_20260809_193921.jsonl"

print(verify(path))