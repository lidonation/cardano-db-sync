/** Roll patch releases up to the roadmap's designed milestone labels. */
export function releaseTrack(releases: readonly string[]): string[] {
  const milestones = new Set<string>();
  for (const version of releases) {
    const parts = version.split('.').map(Number);
    const [major, minor, patch] = parts;
    if (major === undefined || minor === undefined || !parts.every(Number.isSafeInteger)) continue;
    if (major < 13 || (major === 13 && minor < 5)) continue;
    milestones.add(
      major === 13 && minor === 7 && patch !== undefined
        ? `${major}.${minor}.${patch}`
        : `${major}.${minor}`,
    );
  }
  return [...milestones].sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
}
