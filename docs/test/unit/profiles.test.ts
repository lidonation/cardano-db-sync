import {describe, expect, it} from 'vitest';

import {
  PROFILES,
  PROFILE_ENV_VAR,
  PROFILE_NAMES,
  isProfileName,
  resolveProfile,
} from '../../config/profiles';

describe('build profiles (ENV-1, ENV-6)', () => {
  it('exposes exactly the two profiles the specification names', () => {
    expect([...PROFILE_NAMES].sort()).toEqual(['dev', 'prod']);
  });

  it('gives the developer profile the github.io subpath against preview', () => {
    expect(PROFILES.dev.url).toBe('https://lidonation.github.io');
    expect(PROFILES.dev.baseUrl).toBe('/cardano-db-sync/');
    expect(PROFILES.dev.network).toBe('preview');
    expect(PROFILES.dev.indexable).toBe(false);
  });

  it('gives the production profile the domain root against mainnet', () => {
    expect(PROFILES.prod.url).toBe('https://dbsync.cardano.intersect.org');
    expect(PROFILES.prod.baseUrl).toBe('/');
    expect(PROFILES.prod.network).toBe('mainnet');
    expect(PROFILES.prod.indexable).toBe(true);
  });

  it('carries a CNAME host for production only (ENV-6)', () => {
    expect(PROFILES.dev.cname).toBeNull();
    expect(PROFILES.prod.cname).toBe('dbsync.cardano.intersect.org');
  });

  it('points each profile at the repository its content is edited in', () => {
    expect(PROFILES.dev.repoUrl).toBe('https://github.com/lidonation/cardano-db-sync');
    expect(PROFILES.prod.repoUrl).toBe('https://github.com/IntersectMBO/cardano-db-sync');
  });

  it('keeps the two baseUrls different, so the subpath case is always exercised', () => {
    expect(PROFILES.dev.baseUrl).not.toBe(PROFILES.prod.baseUrl);
  });

  it('ends every baseUrl with a slash', () => {
    for (const name of PROFILE_NAMES) {
      expect(PROFILES[name].baseUrl.endsWith('/')).toBe(true);
    }
  });

  it('never lets a profile object be mutated at runtime', () => {
    expect(Object.isFrozen(PROFILES)).toBe(true);
    expect(Object.isFrozen(PROFILES.dev)).toBe(true);
    expect(() => {
      (PROFILES.dev as {cname: string | null}).cname = 'example.test';
    }).toThrow();
  });
});

describe('isProfileName', () => {
  it('accepts the known names', () => {
    expect(isProfileName('dev')).toBe(true);
    expect(isProfileName('prod')).toBe(true);
  });

  it('rejects anything else, including prototype keys and non-strings', () => {
    expect(isProfileName('production')).toBe(false);
    expect(isProfileName('')).toBe(false);
    expect(isProfileName('toString')).toBe(false);
    expect(isProfileName('constructor')).toBe(false);
    expect(isProfileName(undefined)).toBe(false);
    expect(isProfileName(42)).toBe(false);
  });
});

describe('resolveProfile', () => {
  it('resolves each profile by name', () => {
    expect(resolveProfile({[PROFILE_ENV_VAR]: 'dev'})).toBe(PROFILES.dev);
    expect(resolveProfile({[PROFILE_ENV_VAR]: 'prod'})).toBe(PROFILES.prod);
  });

  it('tolerates surrounding whitespace from a shell or CI variable', () => {
    expect(resolveProfile({[PROFILE_ENV_VAR]: ' prod '})).toBe(PROFILES.prod);
  });

  it('throws rather than defaulting when the variable is missing', () => {
    expect(() => resolveProfile({})).toThrow(/is not set/);
  });

  it('throws when the variable is empty or whitespace', () => {
    expect(() => resolveProfile({[PROFILE_ENV_VAR]: ''})).toThrow(/is not set/);
    expect(() => resolveProfile({[PROFILE_ENV_VAR]: '   '})).toThrow(/is not set/);
  });

  it('throws on an unknown profile and names the valid ones', () => {
    expect(() => resolveProfile({[PROFILE_ENV_VAR]: 'staging'})).toThrow(/not a known profile/);
    expect(() => resolveProfile({[PROFILE_ENV_VAR]: 'staging'})).toThrow(/dev, prod/);
  });

  it('does not resolve an inherited Object.prototype key to a profile', () => {
    expect(() => resolveProfile({[PROFILE_ENV_VAR]: 'toString'})).toThrow(/not a known profile/);
  });
});
