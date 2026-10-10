# Cardano DB Sync — brand assets

The mark is a **pointy-top hexagon outline with a center dot** ("block / node" glyph) in **DB Sync Blue `#0F73FF`**. The hexagon is a closed, evenly-mitered ring (no gap at the top).

## Colours

| Token          | Hex       | Use                                  |
| -------------- | --------- | ------------------------------------ |
| DB Sync Blue   | `#0F73FF` | primary mark, badge background       |
| Near-black     | `#0F1117` | monochrome mark on light backgrounds |
| White          | `#FFFFFF` | knockout mark on dark backgrounds    |
| Intersect Navy | `#011555` | supporting                           |

## Files

### Mark (glyph only)

| SVG                  | Description                          | Best on                       |
| -------------------- | ------------------------------------ | ----------------------------- |
| `svg/mark-badge.svg` | white glyph on a blue rounded square | app icon, favicon, avatar     |
| `svg/mark-blue.svg`  | blue glyph, transparent              | light backgrounds             |
| `svg/mark-dark.svg`  | near-black glyph, transparent        | light backgrounds, monochrome |
| `svg/mark-white.svg` | white glyph, transparent             | dark backgrounds (knockout)   |

Each mark is also rasterised to transparent PNG:

```
png/mark-<variant>-<size>.png
variant = badge | blue | dark | white
size    = 16 32 48 64 128 180 192 256 512 1024
```

40 PNGs total. `mark-badge-32.png` / `-16.png` are drop-in favicons; `-180`/`-192` suit Apple-touch / Android; `-512`/`-1024` for stores and social.

### Lockup (glyph + wordmark)

| SVG                    | Description                                  |
| ---------------------- | -------------------------------------------- |
| `svg/lockup-color.svg` | blue glyph + "Cardano DB Sync" in near-black |
| `svg/lockup-dark.svg`  | all near-black (monochrome, light bg)        |
| `svg/lockup-white.svg` | all white (dark bg)                          |

Wordmark is **Space Grotesk** — "Cardano" Light (300), "DB Sync" Bold (700). The SVGs embed a Google Fonts `@import`, so they render the true wordmark in any browser with network; in tools without Space Grotesk they fall back to a system sans.

**Lockup PNGs are not pre-rendered** because Space Grotesk is not installed on the build machine and rendering with a fallback would misrepresent the wordmark. To get a PNG lockup, open the SVG in any tool that has Space Grotesk (Figma, browser, Illustrator) and export — the vector is final.

## Usage

- Keep clear space around the mark ≥ the center-dot diameter.
- Don't recolour, rotate, add effects, or stretch. Use the variant that suits the background instead.
- Minimum legible size: mark 16px, lockup ~120px wide.
- Prefer SVG wherever the medium supports it; PNGs are for fixed-size raster needs.

## Regenerating the PNGs

The marks are drawn with ImageMagick native primitives (the SVGs use `fill-rule:evenodd` hexagon rings, so they also rasterise cleanly). See the mark geometry in `svg/mark-*.svg`; the 64-unit viewBox scales to any size.
