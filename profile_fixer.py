#!/usr/bin/env python3
"""One-off measurement: how much does the fixer cost, and on which values?

Throwaway. Not part of the tool -- delete it once the question is answered.

Edit the three settings below, then:

    cd "/Users/bytedance/Documents/Data workbench"
    python3 profile_fixer.py

What it answers: the fixer short-circuits values that already parse after one
JSON.parse, and only runs its <=400-attempt search on values that do not. So the
cost is concentrated in broken values. This reports how many of yours are broken
and what they cost, which decides whether caching only the broken ones is enough.
"""

# ---------------------------------------------------------------------------
# SETTINGS -- edit these
# ---------------------------------------------------------------------------

FILE = "/Users/bytedance/Documents/Bad case review viewer/secret/phase 4/p4_rubrics_translation-3_20260810_075736.jsonl"

# The path holding embedded JSON, e.g. "payload.body" or "messages.[].content".
# Leave as None to auto-discover every such path and report each separately.
PATH = None

# Only profile the first N records. Set to None for the whole file.
# Start small -- loading a large file costs minutes before profiling even begins.
LIMIT = 2000

# ---------------------------------------------------------------------------

import functools
import json
import os
import sys
import time
from collections import Counter

print = functools.partial(print, flush=True)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fix


def load(path, limit):
    """Records, and the file's size in bytes. Reads only as far as `limit`."""
    if path.endswith((".jsonl", ".ndjson")):
        records, nbytes = [], 0
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                nbytes += len(line.encode())
                if line.strip() and (limit is None or len(records) < limit):
                    records.append(json.loads(line))
        return records, nbytes
    text = fix.read_text(path)
    value = json.loads(text)
    records = value if isinstance(value, list) else [value]
    return (records[:limit] if limit else records), len(text)


def discover(records, sample=200):
    """Dotted paths holding strings that look like embedded JSON."""
    found = Counter()

    def walk(v, path):
        if isinstance(v, dict):
            for k, sub in v.items():
                walk(sub, path + "." + k if path else k)
        elif isinstance(v, list):
            for sub in v[:5]:
                walk(sub, path + ".[]" if path else "[]")
        elif isinstance(v, str) and path:
            if v.lstrip()[:1] in "{[":
                found[path] += 1

    for r in records[:sample]:
        walk(r, "")
    return [p for p, _ in found.most_common()]


def profile(records, path):
    """Time fix.repair over every string value at `path`, split by outcome."""
    steps = fix.parse_path(path)
    stat = dict(n=0, clean=0, repaired=0, failed=0, chars=0,
                t_clean=0.0, t_broken=0.0, causes=Counter(), worst=0.0, worst_raw="")

    for rec in records:
        for container, key in fix.value_refs(rec, steps):
            raw = container[key]
            if not isinstance(raw, str):
                continue
            stat["n"] += 1
            stat["chars"] += len(raw)

            t0 = time.perf_counter()
            r = fix.repair(raw)
            dt = time.perf_counter() - t0

            if r.ok and r.clean:
                stat["clean"] += 1
                stat["t_clean"] += dt
            else:
                stat["t_broken"] += dt
                if r.ok:
                    stat["repaired"] += 1
                else:
                    stat["failed"] += 1
                    stat["causes"][r.cause] += 1
                if dt > stat["worst"]:
                    stat["worst"], stat["worst_raw"] = dt, raw[:80]
    return stat


def report(path, s):
    total = s["t_clean"] + s["t_broken"]
    broken = s["repaired"] + s["failed"]
    print("\npath      %s" % path)
    print("  values  {:,}  ({:,} chars, avg {:,})".format(
        s["n"], s["chars"], s["chars"] // max(s["n"], 1)))
    print("  split   {:,} clean · {:,} repaired · {:,} failed   ({:.1f}% broken)".format(
        s["clean"], s["repaired"], s["failed"], 100.0 * broken / max(s["n"], 1)))
    print("  time    {:.3f}s total  ·  {:.3f}s on the {:,} clean  ·  {:.3f}s on the {:,} broken".format(
        total, s["t_clean"], s["clean"], s["t_broken"], broken))
    if broken:
        print("  per     {:.3f} ms per clean value  ·  {:.3f} ms per broken value".format(
            1000 * s["t_clean"] / max(s["clean"], 1), 1000 * s["t_broken"] / broken))
        print("  worst   {:.1f} ms on: {}".format(1000 * s["worst"], s["worst_raw"]))
    if s["causes"]:
        print("  causes  %s" % ", ".join("%s×%d" % (c, k) for c, k in s["causes"].most_common()))
    return total


def main():
    if not os.path.isfile(FILE):
        sys.exit("profile_fixer: no such file: %s\nEdit FILE at the top of this script." % FILE)

    records, nbytes = load(FILE, LIMIT)
    print("file      %s" % FILE)
    print("size      {:,} bytes".format(nbytes))
    print("profiled  {:,} records{}".format(len(records), " (LIMIT)" if LIMIT else ""))

    paths = [PATH] if PATH else discover(records)
    if not paths:
        sys.exit("\nNo string values looking like embedded JSON found. Set PATH explicitly.")

    grand = 0.0
    for p in paths:
        s = profile(records, p)
        if s["n"]:
            grand += report(p, s)

    print("\nONE full repair pass over these records: {:.3f}s".format(grand))
    print("The tool runs this pass THREE times: unpack, every preview re-render, and export.")
    if LIMIT and len(records) == LIMIT:
        print("Scale by your real record count -- this is the first {:,} only.".format(LIMIT))


if __name__ == "__main__":
    main()



print("run ended")