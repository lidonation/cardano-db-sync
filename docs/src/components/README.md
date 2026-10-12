# Components (B29)

The 27 component definitions from the design file, built once each and themed by token
(THM-5). `inventory.ts` is the manifest. For every definition it records:

- the design name;
- where it is built;
- the `data-dbs-component` marker it renders;
- each of the nine drawn states, either `shown` or a written reason it does not apply (FLOOR-5).

Rules every component here follows:

- **Colour comes from tokens only**, through the generated `--dbs-*` custom properties.
  Text positions use text roles; labels on accent fills use `--dbs-text-on-accent` (TOK-1, TOK-5).
- **Square corners, flat fills, no shadows.** The buttons are the one geometric exception: an
  elongated hexagon drawn by clipped pseudo-elements, so the focus ring stays square (DF-3).
- **Every focusable element** draws `--dbs-focus-ring` at `--dbs-focus-offset` (FLOOR-4).
  Selectable cards draw it on the card around their visually hidden native input.
- **No inline `style` attributes**, because the CSP refuses them (SEC-2). Sizes come from classes,
  and the stat bar is an SVG sized by attribute.
- **No glyph as an icon** (CONTENT-2). Icons are the drawn set in `shared/Icon.tsx`.
- **Selected, error and validation states** carry a glyph, word or shape as well as colour
  (FLOOR-6).
- **Data states** (loading, error, empty) are props. Error copy names the problem and the
  recovery (CONTENT-5).
- **`demo`** pins hover, pressed or focus at rest, so the inventory can audit every state's
  contrast without a pointer. Pages never set it.
- **Control boundaries bind `border.interactive`** — never `border.default`, `border.strong` or
  a warm border — in every state including disabled (TOK-6, FLOOR-3). Static surfaces keep the
  `border.default` hairline; link cards outrank it by `[data-link]`, selectable cards by
  `.card.select`. `check:token-lint` enforces the binding; only documented decorative hairlines
  are exempt.

THM-6 ruling (2026-10-12):

- `Metric / Dark` → `Metric` and `Avatar / Hexagon` → `Avatar`, both themed like everything else.
- `Code / Copy` and `Footer` (the design's `Footer / Navy`) stay theme-invariant.

## The inventory

`src/inventory/` renders every definition in every shown state. It is served only by the
development server:

```sh
DBS_INVENTORY=1 npm start      # then open /__inventory
npm run test:components        # axe × 4 palettes × 3 widths, states, keyboard (Playwright)
```

`plugins/inventory` refuses a production build with the flag set, so the page is never deployed
and never enters the route manifest (VER-5).
