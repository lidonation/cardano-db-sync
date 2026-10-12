/**
 * Replace every comment with spaces of the same shape, so line numbers survive and commented-out
 * code never trips a gate.
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Walk the stylesheet as nested blocks and yield each declaration with the selector chain it sits
 * under. This is a tolerant scanner, not a parser: it understands braces, `;` and `:`, which is
 * all three gates need.
 */
export function* declarations(css) {
  const stack = [];
  const opens = [];
  let start = 0;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(start, i).trim());
      opens.push(i);
      start = i + 1;
    } else if (ch === '}' || ch === ';') {
      const text = css.slice(start, i);
      const colon = text.indexOf(':');
      if (colon !== -1) {
        const offset = start + (text.length - text.trimStart().length);
        yield {
          property: text.slice(0, colon).trim().toLowerCase(),
          value: text.slice(colon + 1).trim(),
          selectors: [...stack],
          block: opens.at(-1) ?? -1,
          offset,
        };
      }
      if (ch === '}') {
        stack.pop();
        opens.pop();
      }
      start = i + 1;
    }
  }
}
