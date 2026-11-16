import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {
  PROFILES,
  PROFILE_ENV_VAR,
  PROFILE_NAMES,
  isProfileName,
  resolveProfile,
  readDocsEnv,
  clientProfile,
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
    expect(PROFILES.prod.url).toBe('https://dbsync.cardano.intersectmbo.org');
    expect(PROFILES.prod.baseUrl).toBe('/');
    expect(PROFILES.prod.network).toBe('mainnet');
    expect(PROFILES.prod.indexable).toBe(true);
  });

  it('carries a CNAME host for production only (ENV-6)', () => {
    expect(PROFILES.dev.cname).toBeNull();
    expect(PROFILES.prod.cname).toBe('dbsync.cardano.intersectmbo.org');
  });

  it('names the GitHub owner and repository each build is published from', () => {
    expect(PROFILES.dev.organizationName).toBe('lidonation');
    expect(PROFILES.prod.organizationName).toBe('IntersectMBO');
    expect(PROFILES.dev.projectName).toBe('cardano-db-sync');
    expect(PROFILES.prod.projectName).toBe('cardano-db-sync');
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

describe('local dev origin', () => {
  it('normalizes the trailing slash without changing the dev route prefix', () => {
    const profile = resolveProfile({
      DOCS_PROFILE: 'dev',
      DOCS_DEV_URL: 'https://preview.example.test/',
    });
    expect(profile).toEqual({...PROFILES.dev, url: 'https://preview.example.test'});
    expect(Object.isFrozen(profile)).toBe(true);
    expect(PROFILES.dev.url).toBe('https://lidonation.github.io');
  });

  it('keeps production unchanged even with an invalid dev override', () => {
    expect(resolveProfile({DOCS_PROFILE: 'prod', DOCS_DEV_URL: 'invalid'})).toBe(PROFILES.prod);
  });

  it('treats a blank override as the default dev profile', () => {
    expect(resolveProfile({DOCS_PROFILE: 'dev', DOCS_DEV_URL: ' '})).toBe(PROFILES.dev);
  });

  it.each([
    'invalid',
    'ftp://preview.example.test',
    'https://user:password@preview.example.test',
    'https://preview.example.test/nested/',
    'https://preview.example.test/?query=1',
    'https://preview.example.test/#fragment',
  ])('rejects non-origin overrides without echoing their contents', (value) => {
    expect(() => resolveProfile({DOCS_PROFILE: 'dev', DOCS_DEV_URL: value})).toThrow(
      /^DOCS_DEV_URL must be an HTTP\(S\) origin, without credentials, path, query or hash\.$/,
    );
  });

  it('serves the dev server from a configured base path, keeping the origin override', () => {
    const profile = resolveProfile({
      DOCS_PROFILE: 'dev',
      NODE_ENV: 'development',
      DOCS_DEV_URL: 'https://preview.example.test/',
      DOCS_DEV_BASE_URL: ' / ',
    });
    expect(profile).toEqual({...PROFILES.dev, url: 'https://preview.example.test', baseUrl: '/'});
    expect(Object.isFrozen(profile)).toBe(true);
    expect(PROFILES.dev.baseUrl).toBe('/cardano-db-sync/');
  });

  it('ignores the base path override outside the dev server and for production', () => {
    expect(
      resolveProfile({DOCS_PROFILE: 'dev', NODE_ENV: 'production', DOCS_DEV_BASE_URL: '/'}),
    ).toBe(PROFILES.dev);
    expect(
      resolveProfile({DOCS_PROFILE: 'prod', NODE_ENV: 'development', DOCS_DEV_BASE_URL: 'bad'}),
    ).toBe(PROFILES.prod);
  });

  it.each(['preview', '/preview', 'https://preview.example.test/', '/a//', '/a?b/'])(
    'rejects a malformed dev base path %s',
    (value) => {
      expect(() =>
        resolveProfile({DOCS_PROFILE: 'dev', NODE_ENV: 'development', DOCS_DEV_BASE_URL: value}),
      ).toThrow(/^DOCS_DEV_BASE_URL must be a path that starts and ends with "\/", e\.g\. "\/"\.$/);
    },
  );

  it('reads dotenv syntax, tolerates an absent file and leaves process.env alone', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-env-'));
    const file = path.join(dir, '.env');
    const before = {...process.env};
    try {
      expect(readDocsEnv(file)).toEqual({});
      writeFileSync(file, '# Preview\nDOCS_DEV_URL="https://preview.example.test/"\n');
      expect(readDocsEnv(file).DOCS_DEV_URL).toBe('https://preview.example.test/');
      expect(process.env).toEqual(before);
      expect(() => readDocsEnv(dir)).toThrow();
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

it('serializes only the environment fields consumed by browser components', () => {
  for (const profile of Object.values(PROFILES)) {
    const client = clientProfile(profile);
    expect(Object.keys(client).sort()).toEqual([
      'baseUrl',
      'indexable',
      'network',
      'repoUrl',
      'url',
    ]);
    for (const key of Object.keys(client) as (keyof typeof client)[])
      expect(client[key]).toBe(profile[key]);
  }
  const override = resolveProfile({
    DOCS_PROFILE: 'dev',
    NODE_ENV: 'development',
    DOCS_DEV_BASE_URL: '/preview/',
  });
  expect(clientProfile(override).baseUrl).toBe('/preview/');
});
