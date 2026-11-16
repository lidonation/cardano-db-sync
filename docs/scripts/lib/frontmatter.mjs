/** Leading YAML frontmatter block; group 1 is the YAML. Callers normalize CRLF first if needed. */
export const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
