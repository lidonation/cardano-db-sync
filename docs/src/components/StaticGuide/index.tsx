import React, {type ReactNode} from 'react';
import CodeBlock from '@theme/CodeBlock';
import Link from '@docusaurus/Link';
import {safeGuideHref, safeGuideRequest, safeGuideTarget} from './security';
import {GUIDE_TAGS, GUIDE_ATTRS} from './schema';

type Metadata = {readonly id: string; readonly permalink: string};
type TocItem = {readonly value: string; readonly id: string; readonly level: number};
type StaticDocument = {
  readonly id: string;
  readonly permalink: string;
  readonly toc: TocItem[];
  readonly nodes: ReactNode[];
};

function reconstruct(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType === Node.COMMENT_NODE) return null;
  if (!(node instanceof Element)) throw new Error('Unsupported guide node');
  const tag = node.tagName.toLowerCase();
  if (!GUIDE_TAGS.has(tag)) throw new Error(`Unsupported guide tag ${tag}`);
  if (tag === 'pre' && node.classList.contains('theme-code-block')) {
    const language = Array.from(node.classList).find((name) => name.startsWith('language-'));
    return (
      <CodeBlock key={key} className={language}>
        {node.querySelector('code')?.textContent ?? ''}
      </CodeBlock>
    );
  }
  if (tag === 'a' && !safeGuideTarget(node.getAttribute('target'), node.getAttribute('rel')))
    throw new Error('Unsafe new-window link');
  const props: Record<string, string | number> = {key};
  for (const {name, value} of Array.from(node.attributes)) {
    if (!GUIDE_ATTRS.has(name)) throw new Error(`Unsupported guide attribute ${name}`);
    if (name === 'href') {
      if (!safeGuideHref(value, location.origin)) throw new Error('Unsafe guide link');
    }
    props[name === 'class' ? 'className' : name === 'tabindex' ? 'tabIndex' : name] =
      name === 'tabindex' ? Number(value) : value;
  }
  const children = Array.from(node.childNodes).map((child, index) =>
    reconstruct(child, `${key}-${index}`),
  );
  const href = node.getAttribute('href');
  if (tag === 'a' && href?.startsWith('/') && !href.startsWith('//')) {
    return React.createElement(Link, {...props, href, autoAddBaseUrl: false}, ...children);
  }
  return React.createElement(tag, props, ...children);
}
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
function headingValue(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
  if (node.nodeType === Node.COMMENT_NODE) return '';
  if (!(node instanceof Element)) throw new Error('Unsupported heading node');
  if (node.classList.contains('hash-link')) return '';
  const body = Array.from(node.childNodes).map(headingValue).join('');
  const tag = node.tagName.toLowerCase();
  return ['code', 'em', 'strong', 'del'].includes(tag) ? `<${tag}>${body}</${tag}>` : body;
}
export async function prepareStaticGuide(metadata: Metadata): Promise<StaticDocument> {
  try {
    let root = document.querySelector<HTMLElement>('[data-static-guide]');
    if (
      !root ||
      root.dataset.staticGuide !== metadata.id ||
      root.dataset.staticPermalink !== metadata.permalink
    ) {
      const url = new URL(metadata.permalink, location.origin);
      if (!safeGuideRequest(url.href, location.origin)) throw new Error('Cross-origin guide');
      const response = await fetch(url.href);
      if (!response.ok || !safeGuideRequest(response.url, location.origin))
        throw new Error('Guide unavailable');
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      root = parsed.querySelector<HTMLElement>('[data-static-guide]');
    }
    if (
      !root ||
      root.dataset.staticGuide !== metadata.id ||
      root.dataset.staticPermalink !== metadata.permalink
    )
      throw new Error('Guide content missing');
    const nodes = Array.from(root.childNodes).map((node, index) =>
      reconstruct(node, String(index)),
    );
    const toc = Array.from(
      root.querySelectorAll<HTMLElement>('h2[id],h3[id],h4[id],h5[id],h6[id]'),
    ).map((heading) => ({
      id: heading.id,
      level: Number(heading.tagName.slice(1)),
      value: Array.from(heading.childNodes).map(headingValue).join(''),
    }));
    return {id: metadata.id, permalink: metadata.permalink, nodes, toc};
  } catch {
    let safeHref: string | undefined;
    try {
      const url = new URL(metadata.permalink, location.origin);
      if (safeGuideRequest(url.href, location.origin))
        safeHref = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      // An invalid path must not become a clickable link.
    }
    return {
      id: metadata.id,
      permalink: metadata.permalink,
      toc: [],
      nodes: [
        <p role="alert" key="unavailable">
          Unable to load guide. {safeHref && <a href={safeHref}>Open guide</a>}
        </p>,
      ],
    };
  }
}
export function StaticGuidePage({document: guide}: {document: StaticDocument}): React.JSX.Element {
  return (
    <div data-static-guide={guide.id} data-static-permalink={guide.permalink}>
      {guide.nodes}
    </div>
  );
}
