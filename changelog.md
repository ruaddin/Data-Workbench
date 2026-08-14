# Changelog

> **Versioning (`MAJOR.MINOR.PATCH`).**
> - **MAJOR** (first number) — major overhauls or breaking rewrites.
> - **MINOR** (middle number) — new major features (e.g. the JSON Fixer).
> - **PATCH** (last number) — minor edits, tweaks, and fixes.

> **Planned vs. shipped.** Entries tagged **[PLANNED]** are designed in
> `specifications.md` but not yet built. Once implemented, drop the **[PLANNED]**
> tag. Workflow: find a entry here → read its section in the spec →
> implement → remove the tag.

> **This file is also inlined in `index.html`** and shown by the in-app changelog
> dialog. When you edit here, paste the result there too — the inlined copy is the
> one users read.

## v1.5.2

The page header lines up with the panel under it.

- **The intro paragraph runs the full width of the page.** It was capped at 640px while
  everything below it — the intake panel, the workspace, the export block — runs out to
  the edge of the main column. One line of prose stopping short of every box beneath it
  read as a ragged corner rather than as a measure someone chose. The cap is gone; the
  header now ends where the panels end.

## v1.5.1

The rail says what its icons are.

- **Hovering a rail icon names it.** Five unlabelled icons in a column is a guessing game
  everyone plays exactly once and then memorises by position, which is fine until the
  positions change — as they do below. The name comes from each button's own
  `aria-label`, so the tooltip cannot drift from what a screen reader is told, and the
  theme button reads *Switch to dark theme* or *Switch to light theme* depending on which
  way the click will actually go.
- **The case viewer moves up under the mark.** It was sitting in the bottom cluster with
  theme, help and changelog — a switch and two dialogs, none of them somewhere you go.
  The viewer is a screen, so it is now grouped as one, separated from the utilities
  rather than filed among them.
- **A disabled viewer button no longer lights up on hover.** It stays disabled until a
  scan finishes, and in its new position it is the first thing under the cursor — where
  a hover highlight was quietly promising a click that does nothing.

## v1.5.0

Read your data one record at a time, at full length, instead of squinting at a grid cell.

- **A new Case viewer, opened from the rail.** Every screen so far answers a question
  about the *file* — how big, which paths differ, what will the export write. None of
  them answers the one you actually ask when something looks wrong: *what does this
  record contain?* Preview comes closest and can't get there, because it's a table that
  cuts every cell at 200 characters — so the 4 KB model output you opened it for is
  exactly the thing it truncates. The viewer gives that field the whole width of the
  page. It walks **every** record, not the first 200, with `‹ › ` and `Alt + ← →`.
- **One section per path you ticked, always in the same place.** Sections come from your
  selection rather than from the record, so the field you're reading doesn't move up and
  down the page as you flip through cases. A path that isn't in this record says
  `absent` — which is deliberately different from `empty` and from `null`, because
  upstream those mean different things. Each section jumps to that path's detail pane
  with one click.
- **Embedded JSON shows up as a table.** Where a field holds JSON and it parses, you get
  a real table — columns, rows, readable — chipped `parsed for display` so you know the
  viewer did that, not the file. Nested structures tabulate too, three levels deep,
  below which they collapse to `{…} 4 keys` and open on click.
- **When it doesn't parse, the viewer shows you where it stopped.** The failure is
  painted in the raw string — the offending token, or the quote that never closed, or
  the brace with no partner. The caption says *parse stopped at char 1*, not *this
  character is wrong*, because for something like `{{"key": "value"}` deleting either
  brace fixes it and guessing which one you meant would be a lie dressed as precision.
  Long values scroll to the error instead of making you hunt for it.
- **And a `Repair for display` button, which repairs nothing.** It runs the fixer on that
  one value so you can see whether it's readable, tells you which rule fired and what it
  cost, and leaves your data completely alone. When you decide the path is worth fixing
  for real, Unpack is one click away in the same place. A button that quietly patched one
  record would put a fix in your export that appears nowhere in the tree, nowhere in the
  residue report, and vanishes on rescan.
- **Markdown renders, when you ask for it.** String sections carry a `raw │ md` toggle,
  off by default and remembered per path. Off by default because `**score**` has two
  asterisks in it and this is a tool for looking at data, not at prose — but one click,
  and it stays on while you page through the file.
- **The zero-network guarantee gets teeth.** Rendering markdown means turning untrusted
  model output into a page, which is how a stray `<img>` in someone's data quietly phones
  home. So the output is sanitized *and* the page now carries a policy the browser
  enforces, blocking every outbound request at the source. The file still never leaves
  your machine — that part hasn't changed, it's just no longer only a promise.
- Adds the first two vendored libraries (`marked` and DOMPurify, ~70 KB). Maths and
  syntax highlighting were considered and refused: KaTeX alone would more than triple the
  download for everyone, to prettify a minority of fields.

## v1.4.0

Before you click Unpack, the tool tells you what is in the file and how long it will take.

- **A path's detail pane now breaks down what does not parse, and why.** `59 of 1,000
  values do not parse` was the whole story until now — true, and no help in deciding what
  to do about it. The pane splits that number by cause: `31 cut off mid-structure` is
  damage upstream and the text is gone, `1 not JSON at all` is usually a refusal that
  landed in the field, and `27 undetermined` is the fixer's call, most of which repair.
  The counts are exact and cost nothing extra — the scan already parses these values, so
  classifying the failures is one extra walk over text it has in hand, capped so a file
  where every record is broken cannot slow the scan down.
- **And an estimate: `Unpack: ~11 s`.** Timing needs real repair runs, so it does not
  happen during the scan — it runs when you open the pane, in the background, and fills
  in. Clean and broken values are timed separately because they differ in cost by orders
  of magnitude, and the sample is spread across the length range on purpose: a sample
  that misses the one 218 KB value in a path of short ones is wrong by tenfold.
- **When one value alone eats the sample, that is the answer, and it says so.** Rather
  than averaging a four-second value into a soothing number, the pane leads with it —
  `⚠ one value alone took 4.2 s to search · record 412 · 218 KB` — and reports the total
  as a floor: `Unpack: at least ~2 min`. The sample size is always on screen, because a
  figure whose provenance is invisible is a figure nobody can discount.
- **The tree row is unchanged.** `→ embedded JSON ×59` already tells you a path needs
  attention, which is all a row you are scanning owes you. The breakdown is one click
  away, in the pane that exists for exactly that.

## v1.3.0

Unpacking and exporting a heavily-embedded file stop being a wait with nothing to look at.

- **The fixer no longer re-tokenises text it has already read.** The search revisits the
  same text repeatedly — candidates come off the original as well as the fixpoint, and
  every rule tokenises independently — so the bounded search was doing far more work than
  its budget suggested. The budget counts search *nodes*; each node costs up to 39
  tokenisations of the whole value, which put the real ceiling near 15,600. Measured on an
  18 KB value: **3,311 `tokenize` calls over 61.6 million characters, cut to 404 calls over
  7.5 million** — about 8× less work for the same result. In the browser that is **395 ms
  down to 113 ms** on one 18 KB value the fixer cannot repair, which is the case that
  dominates real cost. `tokenize` is a pure function, so this changes no repair, no rule
  name and no residue cause; the test suite is green across both simulated engines before
  and after, and now replays the whole corpus through a cold cache and a warm one to prove
  the two agree field for field.
- **A value is repaired once, not three times.** Unpack repaired every value and threw the
  results away; the preview re-repaired the first 200 on every checkbox tick; export
  repaired everything again. `DW.fix` now keeps repaired text — capped at 50 M characters
  and cleared when a new file is scanned. Values that *cannot* be repaired are cached too,
  and they matter most: each one burned the entire search budget on every pass to produce a
  result the pipeline discarded. Export after an unpack no longer repairs anything at all:
  the same 18 KB value costs **1,150 ms across its three passes, down to 117 ms**.
- **Unpack, residue, merge and export report progress and can be cancelled.** All four were
  a single synchronous call that returned one message when it was done; only scan had a
  progress bar or a Cancel. Unpack now reports a live count with its running tallies —
  `312 of 436 · 51 clean · 208 repaired · 53 residue` — rather than a percentage, because
  value costs span four orders of magnitude and a percentage bar would sit still and read
  as a hang.
- **One Cancel, always in the same place.** It used to live in the intake panel and appear
  only during a scan, which is not where you are standing when an unpack is running. It is
  now a single control present whenever any operation is in flight. **Cancelling never
  discards the loaded file** — cancel during an unpack or export leaves your records exactly
  where they are. Cancelling a merge leaves its repaired values merged with the path not yet
  unpacked, and says so instead of implying nothing happened.
- **Fixed: loading a recipe that unpacked more than one path.** The unpacks were fired in a
  loop at a session that carries one command at a time, so their results arrived out of step
  and landed in each other's handlers — the second and later paths were grafted with the
  wrong data. Replies are now matched to the request that asked for them, and a recipe's
  unpacks run one after another.

## v1.2.3

Ticking a checkbox no longer stalls the page.

- **A selection change repaints rows in place instead of rebuilding the tree.** Every
  tick tore down and re-created every visible row — on a 65 MB file with the tree
  expanded, ~1,000 rows per click. It also detached the checkbox you had just clicked,
  so a fast second click landed on an orphaned element and did nothing. Rows now update
  their own checkbox and state chips; the DOM survives the click. Measured on a 65 MB
  JSONL with 1,032 rows built: **71 ms → 3 ms** per tick in the tree, 52 ms → 4 ms in
  Flat, and 110 ms → 6 ms for *Clear selection*.
- **A path's checkbox state comes from one roll-up over the model.** Each row used to
  walk its entire subtree to decide checked / indeterminate, so painting a tree was
  quadratic in subtree size and every tick paid it again.
- **Unticking a container is no longer quadratic** in the selection-order list, which
  was scanned and spliced once per path removed.
- **The sort dropdown and the row count moved behind the preview's debounce.** Both are
  rebuilt from the selection — the row count runs a full export plan — and both were
  running synchronously on the click.
- **The preview grid renders at most 60 columns** (W25). 200 rows against 500 ticked
  paths is 100,000 cells. The cap is on the grid alone: every column is still written on
  export, still appears in each row's literal output line and in the CSV header line,
  and the clipped column names are listed beneath the table.

## v1.2.2

Two export fixes.

- **A key is data, so it can hold `.`, `[`, `]` or `\`.** Paths were built by plain
  concatenation and re-split on every `.`, so a key carrying one of those four
  characters either aborted the whole export — *bad path segment: …* — or resolved to
  nothing and wrote a blank column without saying so. `childPath` now backslash-escapes
  those four and `parsePath` undoes it, which is what makes the round trip lossless.
  Hand-typed paths carry no backslashes and parse exactly as they did before. Where a
  key really does contain one, the escapes show in the column name, because the column
  name is the path.
- ***Row unit* and *Sort rows by* no longer overflow the Export panel.** Both are filled
  with path names and a `<select>` sizes itself to its widest option, so one long path
  pushed the control past the panel edge.

## v1.2.1

Per-path handling moves out of the tree.

- **`as one column`, `parse as JSON` and `pretty-print` are no longer bare checkboxes
  hanging under a tree row.** Sitting one indent below the *selection* checkbox, they
  read as more selection, which none of them is — one is a one-shot action that
  rewrites the skeleton, one redefines what selection means beneath it, and one is a
  deferred export flag. They also injected a ragged half-row between the aligned rows
  W22 exists to align. All three now live in a **Handling** block at the top of the
  **Path detail** pane, which the row click already opens (W24).
- **They say what they do.** A pane has width for a label and a sentence, which a tree
  row does not: *Keep whole — one column*, *Unpack into child paths*,
  *Pretty-print on export*, each with its effect written beside it and its state — keys
  kept, values parsed, repaired and residue — spelled out rather than abbreviated.
- **Unpack is a button, not a checkbox**, because it is an action that rewrites the
  tree, not a setting. Undo is *Collapse back to string*, in the same place.
- **The row reads the state back.** A path with handling set carries a green chip in
  its type cell — `one column`, `unpacked`, `pretty` — so nothing set in the pane is
  invisible where you scan. Green separates *you did this* from the blue chips the
  scan inferred. The Flat view shows the same chips.
- **The Export panel names pretty-print without owning it** — a readout of how many
  paths have it, pointing at Path detail. It is per path, and its exclusivity with
  unpack is only legible next to unpack.

## v1.2.0

The fixer, reworked. Every item below is a value that used to land in residue, or
a repair that used to be accepted when it should not have been.

- **Wrapper braces are repaired** — `{ [ … ] }`, a model wrapping an array in an
  object, is the commonest damaged shape in judge output and was residue in every
  previous version: the stray-bracket search removed one bracket at a time, and the
  pair needs two. Peeling the outer pair is now the first candidate tried, matched on
  characters rather than tokens so an unterminated quote later in the value cannot
  hide the pair that is plainly there (W8).
- **The interior-quote rule works outside Chrome** — it located the failure by reading
  `position N` out of V8's error message, which JavaScriptCore does not emit, so the
  rule was silently dead in Safari and every WebKit view and nowhere else. The fixer
  now finds the failure itself by walking its own token stream. The suite runs against
  both engines' error shapes and reports no drift (W8).
- **Interior quotes are escaped, not substituted** — rule 12 rewrote an interior `"`
  to `'`, changing the content of any value that quoted something. It now escapes to
  `\"`, which parses identically and preserves the text, so a judge reason about
  `"soles"` keeps its quotes (W7).
- **A repair that parses is no longer automatically accepted** — `{"a":1}{"b":2}` was
  being "repaired" into a single object keyed `a':1}{'b`. Concatenated roots, truncated
  values and non-JSON prose are classified and refused before the search starts, and a
  string-extending candidate may not swallow unbalanced brackets (W8).
- **Four new rules** — markdown code fences, prose wrapped around the payload, raw
  control characters inside strings, and invalid escapes such as `\d` or a Windows
  path. Apostrophes inside single-quoted strings, the spec's own listed edge case for
  rule 1 and never implemented, now resolve through the same search as interior
  quotes (W7).
- **Rules run to a fixpoint and the ambiguous ones are a bounded search over it**,
  taking candidates from the original text as well as the rewritten one. A value
  needing a fence stripped, a brace pair peeled and quotes converted comes out in one
  go instead of not at all (W8).
- **Residue says why** — each refused value carries a cause (cut off mid-structure,
  two roots concatenated, not JSON, no reading that parses) rather than a raw engine
  message. The dialog leads with the tally, per-value labels name the class, and the
  downloadable `.jsonl` carries `cause` beside `reason`, so thousands of entries can
  be triaged instead of read (W10).
- Faster on what already worked: every rule opens with a substring guard before
  tokenising, so a 246 KB single-quoted value repairs in ~5 ms against ~12 ms in
  v1.1.0.

## v1.1.0

- **Containers can stay whole** — a nested object no longer has to be exported as a
  scatter of leaf columns. Any container row gains an **as one column** toggle: the
  path itself becomes the column and its value is written as JSON. Deselecting a
  sub-node repackages the object without that key rather than decomposing it; with
  everything ticked the output is the original object, key order intact. Nested
  containers resolve to the outer one, and a container with everything deselected
  emits `{}` so CSV headers stay stable between exports. `specifications.md` →
  Behaviour → "Selection" (W21).
- **The tree row is a column grid** — path, type, size, example and presence each get
  their own column instead of one ragged `·`-joined string, so a file's field sizes
  and examples can be scanned down the page. Type badges drop their counts unless the
  node's types are actually split. The Flat view gains the same size column; the
  TSV/Markdown/JSON Schema emits are unchanged. (W22)
- **Help and changelog are dialogs** — both open from the rail rather than living at
  the bottom of the page, and the changelog is one of them rather than a section
  inside the other. The changelog ships inlined in the page, so it works over
  `file://` with no network request. (W23)

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
- **Progressive scanning** — the tree appears within about a second from the first
  ~1,000 records and refines as the scan runs, instead of holding a progress bar for
  up to a minute. Percentages tick, new paths appear, and the report carries a
  "provisional" badge until the scan completes. Selection works while scanning (W13).
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
- **JSON Fixer** — repairs JSON stored inside string values, the standard failure mode
  of model-generated fields. Twelve deterministic rules (quote style, smart quotes,
  stray brackets, trailing and missing commas, unquoted keys and values, `=` for `:`,
  Python literals, comments, invisible characters, interior quotes) run as a
  **verify-loop**: a fix is accepted only when the result actually parses, tie-broken
  on fewest characters changed. Anything it cannot fix is returned byte-identical
  with the parser's reason. Replaces an agentic step — no network call, immune to
  prompt injection, and it cannot translate multilingual payloads by accident
  (W6–W8).
- **Unpack embedded JSON** — a per-path "parse as JSON" toggle repairs a path's values
  and grafts their structure into the skeleton as real, selectable children with full
  statistics. Recursion is manual, one level per toggle (W9).
- **Residue handling** — values the verify-loop provably cannot fix are surfaced two
  ways: an inline editor when there are fewer than 50, or a downloadable residue file
  that can be repaired externally and merged back in on record index + path (W10).
- **Duplicate-key detection** — reported pre-parse, since `JSON.parse` silently keeps
  the last occurrence and destroys the evidence.
- **Statistics on three surfaces**, each with a distinct job: a persistent **summary
  strip** for file-level facts (records, paths, depth, failures, size, format); a
  **Stats tab** for comparison across paths (sparsest fields ranked, type conflicts,
  cardinality, heaviest fields by bytes); and a **Path detail pane** for one path in
  depth (length histogram, value distribution, top values, null rate, array length
  spread). Clicking a tree row flips the right pane from Preview to Path detail (W11).
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
- **Recipe files** — save the whole configuration (selected paths, unpack toggles,
  explode-by, flatten, split settings, line-break mode, sort, format, record path) as
  a ~2 KB `.recipe.json`, and load it onto another file. Loading reconciles by path
  and reports what matched, what is missing, and what is new. No browser storage, so
  recipes work identically on `file://` and Pages (W14).
- **Redact toggle** strips previews, enums and value labels from the structural
  surfaces and structural exports. It does not blank the preview table — it is a
  report-hygiene switch, not a screen-share switch (W20).
- Single self-contained `index.html`. No build step, no framework, zero network
  requests at runtime. Runs from `file://` and from GitHub Pages (W1).
