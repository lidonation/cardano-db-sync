#!/usr/bin/env python3
"""Generate src/css/tokens.css from design/tokens.source.json.

Usage (from docs/):
    python3 design/tools/tokens-to-css.py design/tokens.source.json > src/css/tokens.css

`npm run tokens` runs exactly that, and `npm run check:tokens` fails CI when the committed
tokens.css differs from a fresh run. Reads design/tokens.source.json (the single origin; also
handles the W3C export shape Penpot writes: one top-level object per set, tokens carrying
{"$value": ..., "$type": ...}). Set names map to themes:

    base      -> :root
    dark      -> [data-theme="dark"]
    cream     -> [data-theme="cream"]
    navy      -> [data-theme="navy"]

The base set's `typography` group is not a flat token tree: Penpot tokens cannot carry a composite
text style. It is emitted as the 13-style scale (DF-1) by emit_typography(). Only the Infima bridge
is still a static block below.
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

def resolve(value):
    """Turn {colors.accent-primary} references into var(...)."""
    if not isinstance(value, str):
        return value
    m = re.fullmatch(r"\{([^}]+)\}", value.strip())
    if m:
        return f"var({varname(m.group(1))})"
    return value

TYPE_STYLE_KEYS = ("family", "size", "weight", "leading", "tracking")

# A CSS letter-spacing the scale may use: 0, or a signed length in em, rem or px.
TRACKING = re.compile(r"0|-?(\d+(\.\d+)?|\.\d+)(em|rem|px)")


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_style(name, style, families):
    """Fail on any metric that would emit invalid or silently-dropped CSS."""
    missing = [k for k in TYPE_STYLE_KEYS if k not in style]
    if missing:
        raise SystemExit(f"typography style {name!r} is missing {', '.join(missing)}")
    if style["family"] not in families:
        raise SystemExit(f"typography style {name!r} uses unknown family {style['family']!r}")
    for key in ("size", "leading"):
        if not is_number(style[key]) or style[key] <= 0:
            raise SystemExit(f"typography style {name!r}: {key} must be a positive number")
    weight = style["weight"]
    if not is_number(weight) or not float(weight).is_integer() or not 1 <= weight <= 1000:
        raise SystemExit(f"typography style {name!r}: weight must be a whole number 1-1000")
    if not isinstance(style["tracking"], str) or not TRACKING.fullmatch(style["tracking"]):
        raise SystemExit(
            f"typography style {name!r}: tracking must be 0 or a length in em, rem or px"
        )


def number(value):
    """CSS number text: 58 -> "58", 11.5 -> "11.5"."""
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def emit_typography(typography):
    """The type families and the 13-style scale (DF-1), as lines of a :root block.

    Each style emits a `font` shorthand plus its parts, because letter-spacing cannot ride in the
    shorthand and the type-scale lint needs a size token to point components at:
      --dbs-font-<style>            weight size/leading family
      --dbs-font-<style>-size       px
      --dbs-font-<style>-leading    unitless line-height
      --dbs-font-<style>-tracking   letter-spacing
    """
    families = typography.get("family") or {}
    styles = typography.get("style") or {}
    if not families or not styles:
        raise SystemExit("tokens.source.json: base.typography needs `family` and `style`")
    lines = ["", "  /* type families and the 13-style scale (DF-1) */"]
    for name, stack in families.items():
        lines.append(f"  --dbs-font-{name}: {stack};")
    lines.append("")
    for name, style in styles.items():
        check_style(name, style, families)
        size, leading = number(style["size"]), number(style["leading"])
        lines.append(
            f"  --dbs-font-{name}: {number(style['weight'])} {size}px/{leading} var(--dbs-font-{style['family']});"
        )
    lines.append("")
    for name, style in styles.items():
        lines.append(f"  --dbs-font-{name}-size: {number(style['size'])}px;")
        lines.append(f"  --dbs-font-{name}-leading: {number(style['leading'])};")
        lines.append(f"  --dbs-font-{name}-tracking: {style['tracking']};")
    return lines


def emit_type_classes(typography):
    """One utility class per style, carrying the font AND its tracking.

    The `font` shorthand cannot carry letter-spacing, so `font: var(--dbs-font-<style>)` alone
    drops the tracking of the tracked styles. The class is the easy way to get both; check:css
    (DF-1) fails any other rule that sets the shorthand without the matching tracking token.
    """
    out = ["/* ---- type classes (DF-1): each style's font and tracking together ---- */"]
    for name in typography["style"]:
        out += [
            f".dbs-type-{name} {{",
            f"  font: var(--dbs-font-{name});",
            f"  letter-spacing: var(--dbs-font-{name}-tracking);",
            "}",
        ]
    return "\n".join(out)


FOCUS_BLOCK = """
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
  --ifm-font-size-base: var(--dbs-font-body-size);
  --ifm-line-height-base: var(--dbs-font-body-leading);
  --ifm-code-font-size: var(--dbs-font-mono-size);
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
    with open(path, encoding="utf-8") as source:
        data = json.load(source)
    out = ['/* cardano-db-sync docs — design tokens',
           '   GENERATED from design/tokens.source.json by design/tools/tokens-to-css.py.',
           '   Do not hand-edit: change the source and run `npm run tokens`. */', '']
    type_scale = None
    for setname, tree in data.items():
        if setname.startswith(("_", "$")):
            continue
        sel = THEME_SELECTOR.get(setname.lower().replace(" ", "-"))
        if sel is None:
            raise SystemExit(
                f"set {setname!r} maps to no theme selector; known sets: {', '.join(THEME_SELECTOR)}"
            )
        tree = dict(tree)
        typography = tree.pop("typography", None)
        if typography is not None and setname != "base":
            raise SystemExit(f"set {setname!r}: typography belongs to the base set only")
        lines = [f"{sel} {{"]
        for dotted, value in flatten(tree):
            lines.append(f"  {varname(dotted)}: {resolve(value)};")
        if typography is not None:
            lines.extend(emit_typography(typography))
            lines.append(FOCUS_BLOCK.rstrip())
            type_scale = typography
        lines.append("}")
        out.append("\n".join(lines))
        out.append("")
    if type_scale is None:
        raise SystemExit("tokens.source.json: the base set has no typography group")
    out.append(emit_type_classes(type_scale))
    out.append(INFIMA_BRIDGE)
    # Byte-identical output on every platform: UTF-8 and LF whatever the locale says.
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    print("\n".join(out))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "design/tokens.source.json")
