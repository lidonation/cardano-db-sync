/** Prototype: preserve metadata and move client content and TOC to already-rendered HTML. */
export function clientModule(source) {
  const start = source.indexOf('function _createMdxContent(');
  const title = source.indexOf('export const contentTitle = ');
  const toc = source.indexOf('export const toc = ');
  const match = source.match(/^export \{default as metadata\} from '([^']+)'\s*$/m);
  if (start < 0 || title < 0 || toc < 0 || title >= toc || toc >= start || !match)
    throw new Error('Unexpected MDX module shape');
  const kept = source.slice(title, toc).replace(match[0], '');
  return `import staticMetadata from ${JSON.stringify(match[1])};\nimport {prepareStaticGuide, StaticGuidePage} from '@site/src/components/StaticGuide';\nexport {staticMetadata as metadata};\nexport const frontMatter = staticMetadata.frontMatter;\n${kept}\nconst staticDocument = await prepareStaticGuide(staticMetadata);\nexport const toc = staticDocument.toc;\nexport default function StaticClient() { return _jsx(StaticGuidePage, {document: staticDocument}); }\n`;
}
export function serverModule(source) {
  const marker = 'export default function MDXContent(';
  const match = source.match(/^export \{default as metadata\} from '([^']+)'\s*$/m);
  if (!source.includes(marker) || !match) throw new Error('Unexpected MDX module shape');
  return (
    source.replace(marker, 'function MDXContent(') +
    `\nimport staticServerMetadata from ${JSON.stringify(match[1])};\nexport default function StaticServer(props) { return _jsx('div', {'data-static-guide': staticServerMetadata.id, 'data-static-permalink': staticServerMetadata.permalink, children: _jsx(MDXContent, {...props})}); }\n`
  );
}
/** Do not replace React content when a guide has interactive procedure tabs. */
export const isInteractive = (source) => source.includes('ProcedureTabs');
