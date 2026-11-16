import type {LoadedContent as PagesContent} from '@docusaurus/plugin-content-pages';
import type {RetirementData} from '../../src/retirement/routes';
import {localePath} from '../../src/i18n/pages';

/** Derive live equivalents from loaded content, not a hand-maintained route guess. */
export function retirementData(
  versions: readonly {
    readonly versionName: string;
    readonly path: string;
    readonly isLast: boolean;
    readonly docs: readonly {readonly permalink: string}[];
  }[],
  pages: PagesContent,
  baseUrl: string,
  tags: readonly string[],
): RetirementData {
  const lines = versions.map((version) => ({
    name: version.versionName,
    path: localePath(version.path, baseUrl),
  }));
  const latest = lines[versions.findIndex((version) => version.isLast)] ??
    lines[0] ?? {name: 'current', path: '/docs'};
  const routes = [
    ...new Set(
      [
        ...pages.map((page) => page.permalink),
        ...versions.flatMap((version) => version.docs.map((doc) => doc.permalink)),
      ].map((route) => localePath(route, baseUrl)),
    ),
  ].sort();
  return {routes, lines, latest, tags};
}
