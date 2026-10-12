/**
 * Every UI string id the ecosystem page renders, for its A11Y-18 language marking: a locale
 * missing any of them shows English, announced as English. `test/unit/ecosystem.test.ts` holds
 * this list equal to the ids in `src/ecosystem/`.
 */
export const ECOSYSTEM_IDS = [
  'ecosystem.add.body',
  'ecosystem.add.issues',
  'ecosystem.add.title',
  'ecosystem.empty.body',
  'ecosystem.empty.discord',
  'ecosystem.empty.title',
  'ecosystem.hero.eyebrow',
  'ecosystem.hero.intro',
  'ecosystem.hero.title',
  'ecosystem.links.repository',
  'ecosystem.tools.eyebrow',
  'ecosystem.tools.sql',
  'ecosystem.tools.title',
] as const;
