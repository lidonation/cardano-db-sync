const epochMilliseconds = {preview: 86_400_000, mainnet: 432_000_000};
const missing = {status: 'unavailable', reason: 'missing'};
const invalid = {status: 'unavailable', reason: 'invalid'};
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const integer = (value) => number(value) && Number.isSafeInteger(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const timestamp = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};
const collection = (value) =>
  Array.isArray(value) &&
  value.length <= 12 &&
  Array.from({length: value.length}, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const unique = (items, key) => new Set(items.map((item) => item[key])).size === items.length;
function isSnapshot(value) {
  if (!record(value) || (value.network !== 'preview' && value.network !== 'mainnet')) return false;
  if (!timestamp(value.updatedAt) || !timestamp(value.nextBoundary) || !text(value.source))
    return false;
  const elapsed = Date.parse(value.nextBoundary) - Date.parse(value.updatedAt);
  if (elapsed <= 0 || elapsed > epochMilliseconds[value.network]) return false;
  if (
    !integer(value.epoch) ||
    !integer(value.blockHeight) ||
    !integer(value.transactions) ||
    !integer(value.blocksThisEpoch)
  )
    return false;
  if (!collection(value.recentEpochs)) return false;
  const epoch = value.epoch;
  const updatedAt = value.updatedAt;
  if (
    !value.recentEpochs.every(
      (item) =>
        record(item) &&
        integer(item.epoch) &&
        item.epoch < epoch &&
        integer(item.blocks) &&
        integer(item.transactions) &&
        timestamp(item.boundary) &&
        item.boundary <= updatedAt,
    )
  )
    return false;
  if (!unique(value.recentEpochs, 'epoch')) return false;
  if (value.storage === null) return true;
  const storage = value.storage;
  if (
    !record(storage) ||
    !text(storage.methodology) ||
    !text(storage.configuration) ||
    !number(storage.databaseGB) ||
    !number(storage.monthlyCostUSD)
  )
    return false;
  if (!collection(storage.tables) || !collection(storage.growth)) return false;
  if (
    !storage.tables.every(
      (item) =>
        record(item) &&
        typeof item.name === 'string' &&
        /^[a-z][a-z0-9_]{0,62}$/.test(item.name) &&
        number(item.gigabytes),
    )
  )
    return false;
  const total = storage.tables.reduce((sum, item) => sum + item.gigabytes, 0);
  // Addition of decimal GB can round upward (0.1 + 0.2). Allow only accumulated IEEE-754 error.
  const tolerance = Number.EPSILON * Math.max(total, storage.databaseGB) * storage.tables.length;
  if (!unique(storage.tables, 'name') || total - storage.databaseGB > tolerance) return false;
  return (
    storage.growth.every(
      (item) =>
        record(item) && integer(item.epoch) && item.epoch <= epoch && number(item.gigabytes),
    ) && unique(storage.growth, 'epoch')
  );
}
/** Fail closed at the committed-snapshot boundary; no browser/provider request or local model. */
export function numbersState(raw, network, asOf) {
  if (raw === null || raw === undefined) return missing;
  if (!isSnapshot(raw) || !timestamp(asOf) || raw.updatedAt > asOf) return invalid;
  if (raw.network !== network) return {status: 'unavailable', reason: 'network'};
  return {status: asOf >= raw.nextBoundary ? 'stale' : 'ready', snapshot: raw};
}
