import {load} from 'cheerio';
import {GUIDE_TAGS, GUIDE_ATTRS} from '../../src/components/StaticGuide/schema';
import {
  safeGuideHref,
  safeGuideRequest,
  safeGuideTarget,
} from '../../src/components/StaticGuide/security';

/** Reject content the browser reconstruction cannot safely preserve. */
export function validateRenderedGuide(html: string): string[] {
  const $ = load(html);
  const errors: string[] = [];
  $('[data-static-guide]').each((_index, node) => {
    const id = $(node).attr('data-static-guide') ?? '';
    const permalink = $(node).attr('data-static-permalink') ?? '';
    const origin = 'https://guide.invalid';
    let valid = /^guides\/[a-z0-9-]+$/.test(id) && safeGuideRequest(permalink, origin);
    if (valid) {
      const pathname = new URL(permalink, origin).pathname.replace(/\/$/, '');
      const suffix = `/${id}`;
      valid =
        pathname.endsWith(suffix) && /\/docs(?:\/[^/]+)?$/.test(pathname.slice(0, -suffix.length));
    }
    if (!valid) errors.push(`Invalid guide route identity ${id}`);
  });
  $('[data-static-guide]')
    .find('*')
    .each((_index, node) => {
      const tag = node.tagName.toLowerCase();
      if (!GUIDE_TAGS.has(tag)) errors.push(`Unsupported guide tag ${tag}`);
      for (const [name, value] of Object.entries(node.attribs ?? {})) {
        if (!GUIDE_ATTRS.has(name)) errors.push(`Unsupported guide attribute ${name}`);
        if (name === 'href' && !safeGuideHref(value, 'https://guide.invalid'))
          errors.push(`Unsafe guide href ${value}`);
      }
      if (
        tag === 'a' &&
        !safeGuideTarget($(node).attr('target') ?? null, $(node).attr('rel') ?? null)
      )
        errors.push('New-window link requires noopener or noreferrer');
    });
  return errors;
}
