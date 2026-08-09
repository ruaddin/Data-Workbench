/* ---------- handling (W24: per-path controls, in the detail pane) ---------- */

// W24. These three used to hang off the tree row as bare checkboxes, one indent
// below the *selection* checkbox, which read them as more selection — they are not.
// They live in the detail pane now, where there is width for a label that says what
// each one does. `handlingSection` returns null for a path that has none.
function handlingRow(title, hint, control){
  const r = el("div", "handling");
  const txt = el("div", "handling-txt");
  txt.appendChild(el("div", "handling-title", title));
  if(hint) txt.appendChild(el("div", "field-hint", hint));
  r.appendChild(txt);
  r.appendChild(control);
  return r;
}

function handlingSection(node, path){
  const embedded = isEmbedded(node), packable = canPackage(node);
  if(!embedded && !packable) return null;

  const s = el("div", "section");
  s.appendChild(el("h3", null, "Handling"));

  if(packable){
    const host = packagedBy(path);
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = state.whole.has(path);
    cb.disabled = host !== null || state.provisional;
    cb.setAttribute("aria-label", "Keep " + path + " whole as one column");
    cb.addEventListener("change", function(){ setWhole(node, path, cb.checked); renderDetail(); });

    let hint;
    if(host !== null){
      // The outer container's JSON already nests this one, so its toggle would do
      // nothing; it renders disabled and says why rather than staying live (W21).
      hint = "Already inside " + host + ", which is packaged whole.";
    } else if(state.whole.has(path)){
      const leaves = leavesOf(node, path);
      let kept = 0;
      for(const l of leaves) if(state.selected.has(l)) kept++;
      hint = kept ? num(kept) + " of " + num(leaves.length) +
                    " keys kept — untick a child below to drop it from the packaged object"
                  : "Everything deselected — the column emits {}";
    } else {
      hint = "One JSON column at this path instead of a column per leaf beneath it.";
    }
    s.appendChild(handlingRow("Keep whole — one column", hint, cb));
  }

  if(embedded){
    const info = state.unpackInfo.get(path);
    const parsedCount = (node.inferred.get("json") || 0);
    const failCount = (node.inferred.get("json?") || 0);

    const grp = el("div", "handling-btns");
    const btn = el("button", "btn-sm", state.unpacked.has(path) ? "Collapse back to string" : "Unpack");
    btn.disabled = state.pretty.has(path) || state.provisional;
    btn.addEventListener("click", function(){
      if(state.unpacked.has(path)) collapseUnpack(path);
      else doUnpack(path);
    });
    grp.appendChild(btn);
    if(info && info.residue.length){
      const b = el("button", "btn-sm", info.residue.length < RESIDUE_INLINE
        ? "Fix " + info.residue.length + " inline" : "Residue…");
      b.addEventListener("click", function(){ openResidue(path); });
      grp.appendChild(b);
    }
    s.appendChild(handlingRow("Unpack into child paths", info && state.unpacked.has(path)
      ? num(info.parsed) + " parsed clean · " + num(info.repaired) + " repaired · " +
        num(info.residue.length) + " residue. Collapsing drops any selection beneath this path."
      : "Repair this path's JSON and graft the structure in as real, selectable children. " +
        num(parsedCount) + " of " + num(parsedCount + failCount) + " parse as they stand · " +
        num(failCount) + " fail.", grp));

    const pc = el("input");
    pc.type = "checkbox";
    pc.checked = state.pretty.has(path);
    pc.disabled = state.unpacked.has(path);
    pc.setAttribute("aria-label", "Pretty-print " + path + " on export");
    pc.addEventListener("change", function(){
      // Unpacking and pretty-printing are mutually exclusive per path (W9).
      if(pc.checked) state.pretty.add(path); else state.pretty.delete(path);
      render(); renderPreview(); renderPrettyNote(); renderDetail();
    });
    s.appendChild(handlingRow("Pretty-print on export", state.unpacked.has(path)
      ? "Unavailable while this path is unpacked — the string is gone, its children carry the values."
      : "Indent this field's JSON in the exported file. Changes the text, not the structure.", pc));
  }

  return s;
}

// The Export panel lists pretty-print among its options (§5) but does not own it —
// it is per path, and its exclusivity with unpack is only legible next to unpack.
function renderPrettyNote(){
  const n = state.pretty.size;
  $("prettyNote").textContent = n
    ? "Pretty-print embedded JSON: " + num(n) + (n === 1 ? " path" : " paths")
    : "Pretty-print embedded JSON: off";
}

// The graft itself is not undone — that would need a re-scan — so the children stay
// in the tree, greyed by nothing and still tickable. What must go is any *selection*
// beneath the path: with the path no longer in `unpacked`, `project` walks into a
// string and returns undefined, so those columns would export silently empty. The
// old row checkbox left exactly that trap behind.
function collapseUnpack(path){
  state.unpacked.delete(path);
  const drop = selectedInOrder().filter(function(p){ return DW.underPath(p, path); });
  if(drop.length) selectPaths(drop, false);
  render(); renderPreview(); renderDetail();
}

function doUnpack(path){
  status("expStatus", "warn", "Repairing and unpacking <code>" + esc(path) + "</code>…");
  show("expStatus");
  session.send({c:"unpack", path:path}, function(m){
    if(m.t === "fail"){ status("expStatus", "err", esc(m.msg)); return; }
    state.unpacked.add(path);
    state.model = m.model;
    state.warnings = m.warnings || state.warnings;
    state.unpackInfo.set(path, {total:m.total, parsed:m.parsed, repaired:m.repaired,
                                residue:m.residue, causes:m.causes || {}});
    state.expanded.add(path);
    status("expStatus", "ok", num(m.parsed) + " parsed cleanly · " + num(m.repaired) + " repaired · " +
      num(m.residue.length) + " residue");
    render(); renderWarnings(); renderExplodeOptions(); renderPreview(); renderDetail();
  });
}

