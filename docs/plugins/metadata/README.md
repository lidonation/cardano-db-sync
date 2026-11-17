# Generated metadata (B21)

The shared contract is `src/metadata/types.ts`. Markdown title/description comes from a remark
AST (h1 and complete lead paragraph), via the supported `markdown.parseFrontMatter` hook, before
Docusaurus builds doc/sidebar metadata. Existing frontmatter is not the metadata source. Legacy titles remain sidebar labels so migrating
metadata does not rename navigation items. New guides need neither duplicated field.

The parser source hash participates in webpack cache identity, so changing the remark transformer
also invalidates cached compiled frontmatter without requiring cache deletion.

The metadata plugin consumes loaded routes and content. The theme emits the same metadata on SSR
and client navigation. Schema/config routes are not created here: a schema producer supplies
`Dataset` columns from its extraction artifact, and the config producer uses `WebApplication`.
Unavailable Updates data produces no invented entries. FAQ retains its visible-content producer.

Production sitemaps are built from public route paths and real translations; untranslated fallback
copies canonicalize to English and are excluded. Redirects and 404s are never sitemap entries.
Lastmod uses committed source/dependency history, never build time. CI must fetch full history.

Social images use design tokens, have no baked-in text, and are generated per emitted content type
as 1200x630 WebP. No unreferenced types are shipped. `check:metadata` validates built structured data;
its seeded-negative unit tests ensure malformed JSON-LD fails rather than passing by inspection.
