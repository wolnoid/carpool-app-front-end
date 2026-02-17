import a from "./DirectionsSidebarA.module.css";
import b from "./DirectionsSidebarB.module.css";

// IMPORTANT:
// These are CSS *modules*. If the same class name exists in both files,
// each module gets its own hashed class name.
//
// Spreading ("{...a, ...b}") causes the later module to *override* the mapping,
// which means the element receives only ONE of the two hashed class names.
// That breaks styling whenever rules for that class exist in BOTH files
// (e.g. `.sidebar` has base rules in A and responsive overrides in B).
//
// Fix: for any overlapping key, concatenate both class names so the element
// receives both hashes and all rules apply.
function mergeCssModules(...mods) {
  const keys = new Set();
  for (const m of mods) {
    if (!m) continue;
    for (const k of Object.keys(m)) keys.add(k);
  }

  const out = {};
  for (const k of keys) {
    const vals = mods
      .map((m) => m?.[k])
      .filter(Boolean);
    out[k] = vals.join(" ");
  }
  return out;
}

export default mergeCssModules(a, b);
