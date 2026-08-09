# Changelog

> **Versioning (`MAJOR.MINOR.PATCH`).**
> - **MAJOR** (first number) — major overhauls or breaking rewrites.
> - **MINOR** (middle number) — new major features (e.g. the JSON Fixer).
> - **PATCH** (last number) — minor edits, tweaks, and fixes.

> **Planned vs. shipped.** Entries tagged **[PLANNED]** are designed in
> `specifications.md` but not yet built. Once implemented, drop the **[PLANNED]**
> tag. Workflow: find a entry here → read its section in the spec →
> implement → remove the tag.

> **Nothing is built yet.** Every entry below is. Build order and the
> reasoning behind it are in `architecture.md` → "Planned".

## v1.3.0

- **Progressive scanning** — the tree appears within about a second from the first
  ~1,000 records and refines as the scan runs, instead of holding a progress bar for
  up to a minute. Percentages tick, new paths appear, and the report carries a
  "provisional" badge until the scan completes. Selection works while scanning.
  Full design in `specifications.md` → Behaviour → "Scan" (W13).
- **Recipe files** — save the whole configuration (selected paths, unpack toggles,
  explode-by, flatten, split settings, line-break mode, sort, format, record path) as
  a ~2 KB `.recipe.json`, and load it onto another file. Loading reconciles by path
  and reports what matched, what is missing, and what is new. No browser storage, so
  recipes work identically on `file://` and Pages. `specifications.md` → Persistence
  (W14).

## v1.2.0

- **JSON Fixer** — repairs JSON stored inside string values, the standard failure mode
  of model-generated fields. Twelve deterministic rules (quote style, smart quotes,
  stray brackets, trailing and missing commas, unquoted keys and values, `=` for `:`,
  Python literals, comments, invisible characters, interior quotes) run as a
  **verify-loop**: a fix is accepted only when the result actually parses, tie-broken
  on fewest characters changed. Anything it cannot fix is returned byte-identical
  with the parser's reason. Replaces an agentic step — no network call, immune to
  prompt injection, and it cannot translate multilingual payloads by accident.
  `specifications.md` → Behaviour → "JSON fixer" (W6–W8).
- **Unpack embedded JSON** — a per-path "parse as JSON" toggle repairs a path's values
  and grafts their structure into the skeleton as real, selectable children with full
  statistics. Recursion is manual, one level per toggle.  (W9)
- **Residue handling** — values the verify-loop provably cannot fix are surfaced two
  ways: an inline editor when there are fewer than 50, or a downloadable residue file
  that can be repaired externally and merged back in on record index + path. (W10)
- **Duplicate-key detection** — reported pre-parse, since `JSON.parse` silently keeps
  the last occurrence and destroys the evidence.

## v1.1.0

- **Statistics on three surfaces**, each with a distinct job: a persistent **summary
  strip** for file-level facts (records, paths, depth, failures, size, format); a
  **Stats tab** for comparison across paths (sparsest fields ranked, type conflicts,
  cardinality, heaviest fields by bytes); and a **Path detail pane** for one path in
  depth (length histogram, value distribution, top values, null rate, array length
  spread). Clicking a tree row flips the right pane from Preview to Path detail.
  `specifications.md` → Behaviour → "Skeleton and statistics" (W11).

## v1.0.0

First release. Consolidates Data Skeleton Script, JSONL Splitter and the Python
JSONL-to-CSV converter into one single-file tool. None of the three are retired.

- Merged structure skeleton across JSON, JSONL/NDJSON, CSV/TSV, XML/HTML and YAML,
  with content-based format detection, presence math relative to parent, type
  inference on all strings, map collapsing, and full array walking — the whole
  Data Skeleton engine, carried over intact (D1–D19).
- **Records retained in the Web Worker** with streamed decoding and chunked Blob
  export, holding peak memory to roughly 1× file size. JSONL and CSV stream to a
  500 MB target; JSON, YAML and XML are capped at 200 MB with the reason stated (W3,
  W4).
- **Path selection** — checkboxes in both the Tree and Flat views, driving one shared
  selection set. The Flat view gains search and sort; the emit dropdown (bare list,
  TSV, Markdown, JSON Schema) gains a Selected / All switch (W16).
- **CSV and JSONL export** from the selected paths. Paths inside arrays project into
  a single JSON-array column, preserving one row per record; a single **explode-by**
  picker switches the row unit to one collection's elements and announces the
  resulting row count before you run it (W5).
- **Map-aware selection** — collapsed `{*}` nodes project as objects keyed by the map
  key, are tickable as the key itself, and can be exploded into one row per entry
  (W19).
- **Preview table** over the first ~200 records, with per-row expansion to the literal
  output line. Preview and export share one pipeline implementation, so the preview
  cannot drift from what gets written (W18).
- Export transforms: **flatten** nested keys to dotted paths, **split** over-long
  top-level strings at a configurable cap, **remove line breaks**, **pretty-print**
  embedded JSON, and **sort rows** by any selected column (W2, W12).
- **Number guards** — integers above 2^53−1 are quoted on CSV export so 19-digit ids
  survive a spreadsheet, and precision-loss warnings fire on any numeric literal that
  cannot round-trip, in both formats (W15).
- **Warnings panel** consolidating parse failures, ragged CSV rows, precision loss,
  flatten and split collisions, oversize values, and duplicate keys.
- **Redact toggle** strips previews, enums and value labels from the structural
  surfaces and structural exports. It does not blank the preview table — it is a
  report-hygiene switch, not a screen-share switch (W20).
- Single self-contained `index.html`. No build step, no framework, zero network
  requests at runtime. Runs from `file://` and from GitHub Pages (W1).
