#!/usr/bin/env python3
"""Generate design/tokens.css from a Penpot token export (tokens.json).

Usage:  python3 design/tools/tokens-to-css.py design/tokens.source.json > design/tokens.css

Reads design/tokens.source.json (the single origin; also handles the W3C export
shape Penpot writes: one top-level object per set,
tokens carrying {"$value": ..., "$type": ...}. Set names map to themes:

    base      -> :root
    dark      -> [data-theme="dark"]
    cream     -> [data-theme="cream"]
    navy      -> [data-theme="navy"]

Everything else in tokens.css (type scale, Infima bridge) is emitted from the
static blocks below, because Penpot tokens do not carry composite typography.
"""
import json, sys, re

THEME_SELECTOR = {
    "base": ":root",
    "light": ":root",
    "dark": '[data-theme="dark"]',
    "cream": '[data-theme="cream"]',
    "navy": '[data-theme="navy"]',
    "intersect-navy": '[data-theme="navy"]',
}

def flatten(node, prefix=()):
    """Yield (dotted-name, value) for every leaf token.

    Handles both the W3C export shape ({"$value": ...}) and the plain nested
    shape used by design/tokens.source.json ({"surface": {"base": "#fff"}})."""
    if isinstance(node, dict):
        if "$value" in node or "value" in node:
            yield ".".join(prefix), node.get("$value", node.get("value"))
            return
        for k, v in node.items():
            if k.startswith("$") or k.startswith("_"):
                continue
            yield from flatten(v, prefix + (k,))
    elif prefix:
        yield ".".join(prefix), node

def varname(dotted):
    return "--dbs-" + re.sub(r"[^a-z0-9]+", "-", dotted.lower()).strip("-")

def resolve(value, table):
    """Turn {colors.accent-primary} references into var(...)."""
    if not isinstance(value, str):
        return value
    m = re.fullmatch(r"\{([^}]+)\}", value.strip())
    if m:
        return f"var({varname(m.group(1))})"
    return value

STATIC_TYPE_BLOCK = """
  /* type families and the 13-style scale — held as Penpot typography assets,
     not tokens, because Penpot tokens cannot carry a composite text style. */
  --dbs-font-heading: "Space Grotesk", system-ui, sans-serif;
  --dbs-font-ui: Inter, system-ui, sans-serif;
  --dbs-font-code: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --dbs-font-display-hero: 700 58px/1.1 var(--dbs-font-heading);
  --dbs-font-heading-lg: 700 38px/1.2 var(--dbs-font-heading);
  --dbs-font-heading-md: 700 26px/1.25 var(--dbs-font-heading);
  --dbs-font-title: 600 20px/1.3 var(--dbs-font-heading);
  --dbs-font-wordmark: 300 19px/1.2 var(--dbs-font-heading);
  --dbs-font-body: 400 15px/1.65 var(--dbs-font-ui);
  --dbs-font-body-sm: 400 13px/1.6 var(--dbs-font-ui);
  --dbs-font-label: 600 14px/1.2 var(--dbs-font-ui);
  --dbs-font-label-sm: 700 12px/1.2 var(--dbs-font-ui);
  --dbs-font-caption: 400 12px/1.4 var(--dbs-font-ui);
  --dbs-font-mono: 400 13px/1.5 var(--dbs-font-code);
  --dbs-font-mono-sm: 400 11.5px/1.5 var(--dbs-font-code);
  --dbs-font-eyebrow: 600 13px/1.2 var(--dbs-font-code);

  --dbs-focus-ring: 2px solid var(--dbs-accent-primary);
  --dbs-focus-offset: 2px;
"""

INFIMA_BRIDGE = """
/* ---- Infima bridge — the ONLY place --ifm-* is assigned ---- */
:root {
  --ifm-color-primary: var(--dbs-accent-primary);
  --ifm-link-color: var(--dbs-accent-primary-text);
  --ifm-background-color: var(--dbs-surface-base);
  --ifm-background-surface-color: var(--dbs-surface-sunken);
  --ifm-font-color-base: var(--dbs-text-primary);
  --ifm-font-color-secondary: var(--dbs-text-secondary);
  --ifm-font-family-base: var(--dbs-font-ui);
  --ifm-heading-font-family: var(--dbs-font-heading);
  --ifm-font-family-monospace: var(--dbs-font-code);
  --ifm-font-size-base: 15px;
  --ifm-line-height-base: 1.65;
  --ifm-code-font-size: 13px;
  --ifm-global-radius: var(--dbs-radius-md);
  --ifm-toc-border-color: var(--dbs-border-default);
  --ifm-navbar-height: 72px;
  --ifm-navbar-background-color: var(--dbs-surface-base);
  --ifm-footer-background-color: var(--dbs-brand-intersect-navy);
  --ifm-footer-link-color: var(--dbs-text-on-navy);
  --ifm-spacing-horizontal: var(--dbs-space-24);
  /* the design has no shadows — neutralise Infima's */
  --ifm-global-shadow-lw: none;
  --ifm-global-shadow-md: none;
  --ifm-global-shadow-tl: none;
}
"""

def main(path):
    data = json.load(open(path))
    out = ['/* cardano-db-sync docs — design tokens',
           '   GENERATED from the Penpot file "Cardano dbsync" token library.',
           '   Do not hand-edit: change design/tokens.source.json and re-run',
           '   design/tools/tokens-to-css.py. */', '']
    emitted_static = False
    for setname, tree in data.items():
        if setname.startswith("_"):
            continue
        if setname.startswith("$"):
            continue
        sel = THEME_SELECTOR.get(setname.lower().replace(" ", "-"))
        if sel is None:
            continue
        lines = [f"{sel} {{"]
        for dotted, value in flatten(tree):
            lines.append(f"  {varname(dotted)}: {resolve(value, data)};")
        if sel == ":root" and not emitted_static:
            lines.append(STATIC_TYPE_BLOCK.rstrip())
            emitted_static = True
        lines.append("}")
        out.append("\n".join(lines))
        out.append("")
    out.append(INFIMA_BRIDGE)
    print("\n".join(out))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "design/tokens.source.json")
