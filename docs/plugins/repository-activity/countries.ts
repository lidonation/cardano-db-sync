/** Reviewed exact country and city aliases, deliberately conservative: ambiguous strings are unknown. */
const locations: Record<string, string> = {
  kenya: 'Kenya',
  nairobi: 'Kenya',
  'united kingdom': 'United Kingdom',
  uk: 'United Kingdom',
  london: 'United Kingdom',
  'united states': 'United States',
  usa: 'United States',
  'united states of america': 'United States',
  canada: 'Canada',
  toronto: 'Canada',
  vancouver: 'Canada',
  germany: 'Germany',
  deutschland: 'Germany',
  berlin: 'Germany',
  france: 'France',
  paris: 'France',
  netherlands: 'Netherlands',
  amsterdam: 'Netherlands',
  australia: 'Australia',
  sydney: 'Australia',
  melbourne: 'Australia',
  switzerland: 'Switzerland',
  zurich: 'Switzerland',
  sweden: 'Sweden',
  norway: 'Norway',
  denmark: 'Denmark',
  finland: 'Finland',
  ireland: 'Ireland',
  dublin: 'Ireland',
  spain: 'Spain',
  madrid: 'Spain',
  portugal: 'Portugal',
  lisbon: 'Portugal',
  italy: 'Italy',
  poland: 'Poland',
  warsaw: 'Poland',
  austria: 'Austria',
  vienna: 'Austria',
  belgium: 'Belgium',
  'czech republic': 'Czechia',
  czechia: 'Czechia',
  romania: 'Romania',
  hungary: 'Hungary',
  ukraine: 'Ukraine',
  greece: 'Greece',
  japan: 'Japan',
  tokyo: 'Japan',
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

export function countryForLocation(location: string): string | null {
  const parts = location
    .toLocaleLowerCase('en')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const matches = new Set(
    parts
      .map((part) => (Object.hasOwn(locations, part) ? locations[part] : undefined))
      .filter((part): part is string => !!part),
  );
  return matches.size === 1 ? [...matches][0] : null;
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
