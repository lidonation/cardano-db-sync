/** Reviewed exact country and city aliases, deliberately conservative: ambiguous strings are unknown. */
const countries: Record<string, string> = {
  kenya: 'Kenya',
  'united kingdom': 'United Kingdom',
  uk: 'United Kingdom',
  'united states': 'United States',
  usa: 'United States',
  'united states of america': 'United States',
  canada: 'Canada',
  germany: 'Germany',
  deutschland: 'Germany',
  france: 'France',
  netherlands: 'Netherlands',
  australia: 'Australia',
  switzerland: 'Switzerland',
  sweden: 'Sweden',
  norway: 'Norway',
  denmark: 'Denmark',
  finland: 'Finland',
  ireland: 'Ireland',
  spain: 'Spain',
  portugal: 'Portugal',
  italy: 'Italy',
  poland: 'Poland',
  austria: 'Austria',
  belgium: 'Belgium',
  'czech republic': 'Czechia',
  czechia: 'Czechia',
  romania: 'Romania',
  hungary: 'Hungary',
  ukraine: 'Ukraine',
  greece: 'Greece',
  japan: 'Japan',
  singapore: 'Singapore',
  india: 'India',
  brazil: 'Brazil',
  argentina: 'Argentina',
  mexico: 'Mexico',
  colombia: 'Colombia',
  nigeria: 'Nigeria',
  'south africa': 'South Africa',
  'new zealand': 'New Zealand',
  indonesia: 'Indonesia',
  vietnam: 'Vietnam',
  philippines: 'Philippines',
  turkey: 'Turkey',
  türkiye: 'Turkey',
};

// City-only aliases are separate so they cannot override an explicit country.
// London, Paris and Vancouver are ambiguous and deliberately remain unknown.
const cities: Record<string, string> = {
  nairobi: 'Kenya',
  toronto: 'Canada',
  berlin: 'Germany',
  amsterdam: 'Netherlands',
  sydney: 'Australia',
  melbourne: 'Australia',
  zurich: 'Switzerland',
  dublin: 'Ireland',
  madrid: 'Spain',
  lisbon: 'Portugal',
  warsaw: 'Poland',
  vienna: 'Austria',
  tokyo: 'Japan',
};

export function countryForLocation(location: string): string | null {
  const parts = location
    .toLocaleLowerCase('en')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const matches = (lookup: Record<string, string>) =>
    new Set(parts.flatMap((part) => (Object.hasOwn(lookup, part) ? [lookup[part]] : [])));
  const explicit = matches(countries);
  if (explicit.size) return explicit.size === 1 ? [...explicit][0] : null;
  const inferred = matches(cities);
  return inferred.size === 1 ? [...inferred][0] : null;
}

export function aggregateCountries(profiles: readonly (string | null)[]) {
  const counts = new Map<string, number>();
  let unknownCountries = 0;
  for (const location of profiles) {
    const country = countryForLocation(location ?? '');
    if (country === null) unknownCountries++;
    else counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return {
    countries: [...counts]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([country, count]) => ({country, count})),
    unknownCountries,
  };
}
