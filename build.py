#!/usr/bin/env python3
"""Assemble src/ into the single-file index.html the spec ships (W1).

    python3 build.py            # write index.html
    python3 build.py --check    # exit 1 if index.html is stale, write nothing

Delivery is unchanged: one self-contained file, no build step for whoever opens
it, no network at runtime. This script exists only so the source is editable in
pieces. index.html stays committed -- it is the artefact, not a by-product.

Every `<!--@@ path @@-->` line in src/index.template.html is replaced by that
file's bytes, verbatim. Nothing else is touched: no minifying, no reordering, no
whitespace fixing. A fragment is a line range, not a module in its own right --
the core and ui script blocks are each one IIFE whose wrapper lives in the
template, so fragment order is load-bearing.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
TEMPLATE = os.path.join(SRC, "index.template.html")
OUTPUT = os.path.join(ROOT, "index.html")

INCLUDE = re.compile(r"^<!--@@ (.+?) @@-->$")


def render():
    with open(TEMPLATE, "r", encoding="utf-8", newline="") as f:
        template = f.readlines()

    out = []
    for n, line in enumerate(template, 1):
        m = INCLUDE.match(line.rstrip("\n"))
        if not m:
            out.append(line)
            continue
        path = os.path.join(SRC, m.group(1))
        if not os.path.isfile(path):
            sys.exit("index.template.html:%d: no such fragment: %s" % (n, m.group(1)))
        with open(path, "r", encoding="utf-8", newline="") as f:
            body = f.read()
        if body and not body.endswith("\n"):
            body += "\n"
        out.append(body)
    return "".join(out)


def main():
    check = "--check" in sys.argv[1:]
    built = render()

    current = None
    if os.path.isfile(OUTPUT):
        with open(OUTPUT, "r", encoding="utf-8", newline="") as f:
            current = f.read()

    if check:
        if current != built:
            sys.exit("index.html is stale -- run: python3 build.py")
        print("index.html is up to date")
        return

    if current == built:
        print("index.html unchanged")
        return

    with open(OUTPUT, "w", encoding="utf-8", newline="") as f:
        f.write(built)
    print("index.html written (%d lines, %d bytes)" % (built.count("\n"), len(built.encode())))


if __name__ == "__main__":
    main()
