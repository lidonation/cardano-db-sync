import {describe, expect, it} from 'vitest';
import {COUNTRY_POINTS} from '../../src/repository-activity/world';
import {aggregateCountries, countryForLocation} from '../../plugins/repository-activity/countries';

describe('profile locations', () => {
  it('recognizes reviewed location strings without guessing ambiguous locations', () => {
    expect(countryForLocation('Nairobi, Kenya')).toBe('Kenya');
    expect(countryForLocation('United Kingdom')).toBe('United Kingdom');
    expect(countryForLocation('Somewhere on Earth')).toBeNull();
    expect(countryForLocation('')).toBeNull();
    expect(countryForLocation('constructor')).toBeNull();
  });
  it('uses explicit countries and leaves ambiguous city-only locations unknown', () => {
    expect(countryForLocation('London, Canada')).toBe('Canada');
    expect(countryForLocation('Vancouver, United States')).toBe('United States');
    expect(countryForLocation('Paris')).toBeNull();
    expect(countryForLocation('London')).toBeNull();
    expect(countryForLocation('Kenya, Canada')).toBeNull();
  });
  it('publishes only aggregate counts, with an unknown bucket', () => {
    const result = aggregateCountries(['Nairobi, Kenya', 'Kenya', 'Unknown', null]);
    expect(result).toEqual({countries: [{country: 'Kenya', count: 2}], unknownCountries: 2});
    expect(JSON.stringify(result)).not.toContain('Nairobi');
  });
  it('places each supported country on the map', () => {
    const names = [
      'Kenya',
      'United Kingdom',
      'United States',
      'Canada',
      'Germany',
      'France',
      'Netherlands',
      'Australia',
      'Switzerland',
      'Sweden',
      'Norway',
      'Denmark',
      'Finland',
      'Ireland',
      'Spain',
      'Portugal',
      'Italy',
      'Poland',
      'Austria',
      'Belgium',
      'Czechia',
      'Romania',
      'Hungary',
      'Ukraine',
      'Greece',
      'Japan',
      'Singapore',
      'India',
      'Brazil',
      'Argentina',
      'Mexico',
      'Colombia',
      'Nigeria',
      'South Africa',
      'New Zealand',
      'Indonesia',
      'Vietnam',
      'Philippines',
      'Turkey',
    ];
    expect(names.filter((name) => !Object.hasOwn(COUNTRY_POINTS, name))).toEqual([]);
  });
  it('keeps arbitrary seeded input private and accounts for every record', () => {
    let seed = 0x15252;
    const locations = Array.from({length: 500}, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return `unmatched-${seed}`;
    });
    const result = aggregateCountries(locations);
    expect(
      result.unknownCountries + result.countries.reduce((sum, row) => sum + row.count, 0),
    ).toBe(locations.length);
    expect(JSON.stringify(result)).not.toContain('unmatched-');
  });
});
