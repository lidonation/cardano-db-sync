/** Browser-safe access to the same reviewed declarations and derived ranges used by CI. */
export function guidesForTable(artifact, table) {
  return Object.entries(artifact.guides ?? {})
    .filter(([, entities]) =>
      Object.keys(entities).some(
        (key) => key === `tables:${table}` || key.startsWith(`columns:${table}.`),
      ),
    )
    .map(([name]) => name)
    .sort();
}

export function versionsForGuide(artifact, guide) {
  return [...(artifact.ranges?.[guide] ?? [])];
}

/** Variant availability is kept alongside the same release range. */
export function variantsForGuide(artifact, guide) {
  return Object.fromEntries(
    Object.entries(artifact.variants?.[guide] ?? {}).map(([version, variants]) => [
      version,
      [...variants],
    ]),
  );
}
