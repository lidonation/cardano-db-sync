import {unified} from 'unified';
import remarkParse from 'remark-parse';

/** Plain text from the remark AST: links retain labels, code retains text, markup does not. */
function text(node) {
  if (['html', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression'].includes(node.type)) return '';
  if (node.type === 'image') return node.alt ?? '';
  return node.value ?? (node.children ?? []).map(text).join('');
}
const normalize = (value) => value.replace(/\s+/g, ' ').trim();

/** A real remark transformer, also used before Docusaurus freezes its sidebar/doc metadata. */
export function remarkMetadata(options = {}) {
  return (tree, file) => {
    const headings = tree.children.filter((node) => node.type === 'heading' && node.depth === 1);
    if (headings.length > 1) throw new Error('CONTENT-4: expected exactly one h1');
    const title = normalize(headings.length ? text(headings[0]) : (options.title ?? ''));
    const start = headings.length ? tree.children.indexOf(headings[0]) + 1 : 0;
    const lead = tree.children.slice(start).find((node) => node.type === 'paragraph');
    const description = lead ? normalize(text(lead)) : '';
    if (!title)
      throw new Error(
        'CON-3: content needs an h1 or sidebar title' +
          (!description ? ' and a lead paragraph (description)' : ''),
      );
    if (!description) throw new Error('CON-3: content needs a non-empty lead paragraph');
    const steps = [];
    for (let i = start; i < tree.children.length; i++) {
      const node = tree.children[i];
      if (node.type !== 'heading' || node.depth !== 2) continue;
      let end = i + 1;
      while (end < tree.children.length && tree.children[end].type !== 'heading') end++;
      const paragraphs = tree.children
        .slice(i + 1, end)
        .filter((item) => item.type === 'paragraph');
      const body = normalize(paragraphs.length ? text(paragraphs[0]) : '');
      const name = normalize(text(node));
      if (name) steps.push({name, text: body || name});
    }
    file.data.metadata = {title, description, steps};
  };
}

export function deriveMetadata(content, title) {
  const processor = unified().use(remarkParse).use(remarkMetadata, {title});
  const file = {data: {}};
  processor.runSync(processor.parse(content), file);
  return file.data.metadata;
}

/** Supported Docusaurus hook: no source mutation or authored metadata boilerplate. */
export async function parseMetadataFrontMatter(params) {
  const result = await params.defaultParseFrontMatter(params);
  const {title, description, steps} = deriveMetadata(
    result.content,
    result.frontMatter.sidebar_label ?? result.frontMatter.title,
  );
  return {
    ...result,
    frontMatter: {
      ...result.frontMatter,
      // Preserve existing navigation wording; it is not the page metadata source.
      sidebar_label: result.frontMatter.sidebar_label ?? result.frontMatter.title,
      title,
      description,
      metadata_steps: steps.map((step) => ({...step, text: step.text.slice(0, 120)})),
    },
  };
}
