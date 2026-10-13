/** Reviewed exceptions require an exact file, rule, match and nonempty reason. */
export const CSS_GATE_ALLOWLIST = [
  {
    file: 'src/css/switchers.css',
    rule: 'REUSE-1',
    text: 'font: var(--dbs-font-label)',
    reason: 'stock Docusaurus markup, cannot take a utility class',
  },
  {
    file: 'src/updates/styles.module.css',
    rule: 'TOK-16',
    threshold: '440px',
    reason: 'content-driven container breakpoint: panel maximum width',
  },
  {
    file: 'src/numbers/styles.module.css',
    rule: 'TOK-16',
    threshold: '479px',
    reason: 'content-driven container breakpoint: single metric column',
  },
];
