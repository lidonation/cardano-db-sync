/** Upgrade GitHub-readable CommonMark without requiring JSX in authored documents. */
export default function guideMarkdown() {
  return (tree) => visit(tree);
}

function element(name, attributes, children) {
  return {
    type: 'mdxJsxFlowElement',
    name,
    attributes: Object.entries(attributes).map(([key, value]) => ({
      type: 'mdxJsxAttribute',
      name: key,
      value,
    })),
    children,
  };
}

function label(node) {
  if (node.type !== 'code' || typeof node.meta !== 'string') return null;
  const match = /^tab="([^"\n]+)"$/.exec(node.meta.trim());
  return match?.[1].trim() || null;
}

function visit(node) {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) visit(child);
  if (node.type === 'blockquote') {
    const paragraph = node.children[0];
    const first = paragraph?.type === 'paragraph' && paragraph.children?.[0];
    const match =
      first?.type === 'text' &&
      /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i.exec(first.value);
    if (match) {
      first.value = first.value.slice(match[0].length);
      if (!first.value) paragraph.children.shift();
      if (!paragraph.children.length) node.children.shift();
      Object.assign(node, element('GuideAlert', {kind: match[1].toLowerCase()}, node.children));
      return;
    }
  }
  const result = [];
  for (let i = 0; i < node.children.length;) {
    const firstLabel = label(node.children[i]);
    if (!firstLabel) {
      result.push(node.children[i++]);
      continue;
    }
    let end = i;
    while (end < node.children.length && label(node.children[end])) end++;
    const group = node.children.slice(i, end);
    const labels = group.map(label);
    if (group.length < 2 || new Set(labels).size !== labels.length) {
      result.push(...group);
    } else {
      result.push(
        element(
          'ProcedureTabs',
          {},
          group.map((code, n) =>
            element('ProcedureTab', {label: labels[n]}, [{...code, meta: null}]),
          ),
        ),
      );
    }
    i = end;
  }
  node.children = result;
}
