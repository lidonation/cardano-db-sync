/** Select the five newest numeric minor lines, independent of release dates. */
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MIGRATION = /^schema\/migration-([24])-(\d{4})-\d{8}\.sql$/;

function compareVersions(a, b) {
  const aa = a.split('.').map(BigInt);
  const bb = b.split('.').map(BigInt);
  for (let i = 0; i < 4; i += 1) {
    if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

/** @param {string[]} tags */
export function selectReleaseTags(tags) {
  const releases = [...new Set(tags.filter((tag) => RELEASE.test(tag)))].sort(compareVersions);
  const lines = [...new Set(releases.map((tag) => tag.split('.').slice(0, 2).join('.')))];
  const retained = new Set(lines.slice(-5));
  return releases.filter((tag) => retained.has(tag.split('.').slice(0, 2).join('.')));
}

/** Stage numbers are migration sequence numbers; date suffixes never determine ordering. */
/** @param {string[]} paths */
export function versionsFromTree(paths) {
  const stages = new Map();
  for (const name of paths) {
    const match = MIGRATION.exec(name);
    if (!match) {
      if (/^schema\/migration-[24]-.*\.sql$/.test(name))
        throw new Error(`Malformed migration: ${name}`);
      continue;
    }
    const [, stage, version] = match;
    if (!stages.has(stage) || version > stages.get(stage)) stages.set(stage, version);
  }
  if (!stages.has('2') || !stages.has('4'))
    throw new Error('tag is missing stage 2 or stage 4 migrations');
  return {stage_two: stages.get('2'), stage_four: stages.get('4')};
}

/** @param {string[]} tags
 * @param {(tag: string) => string[]} treeForTag
 */
export function deriveVersions(tags, treeForTag) {
  return tags.map((tag) => ({tag, ...versionsFromTree(treeForTag(tag))}));
}
