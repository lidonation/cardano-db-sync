/** Build-side B18 history, reusing B08's exact resolved column fingerprints. */

/**
 * The one table route rule, shared by the generated pages and the guides' forward links.
 * @param {string} name
 * @param {string} [variant]
 * @returns {string}
 */
export const tablePath = (name, variant = 'core') =>
  `/schema/${variant === 'address' ? 'address/' : ''}${name}`;
export function canonicalName(renames, kind, name, table) {
  return (
    renames.entities.find(
      (entity) =>
        entity.kind === kind &&
        entity.table === table &&
        (entity.name === name || entity.formerNames.some((former) => former.name === name)),
    )?.name ?? name
  );
}
export function columnChanges(before, after, renames) {
  function index(tables) {
    const result = new Map();
    for (const table of tables) {
      const owner = canonicalName(renames, 'table', table.name);
      for (const column of table.columns) {
        const name = canonicalName(renames, 'column', column.name, owner);
        const key = `${owner}.${name}`;
        if (result.has(key)) throw new Error(`schema history alias collision: ${key}`);
        result.set(key, {table: owner, column: name, value: column});
      }
    }
    return result;
  }
  const old = index(before),
    next = index(after);
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((key) => {
    const previous = old.get(key)?.value ?? null,
      value = next.get(key)?.value ?? null;
    if (previous?.fingerprint === value?.fingerprint) return [];
    const {table, column} = next.get(key) ?? old.get(key);
    return [{table, column, before: previous, after: value}];
  });
}
