import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';

/**
 * Build profiles — the single origin for every environment-dependent value.
 *
 * SPECIFICATION §5: one codebase, two profiles. The developer profile publishes the fork to a
 * `github.io` subpath against Cardano preview; the production profile publishes upstream at a
 * domain root against mainnet.
 *
 * ENV-1: `baseUrl` is a variable at every use site. The literal `/cardano-db-sync/` appears in
 * this file and nowhere else in the source tree. `npm run check:baseurl` enforces that.
 *
 * ENV-6: the GitHub Pages `CNAME` file is emitted from the build profile, for production only.
 * `cname: null` on the developer profile is what makes the developer output CNAME-free.
 */

/** Read an optional docs-local dotenv without changing process.env or exposing it to pages. */
export function readDocsEnv(file = path.resolve(__dirname, '../.env')): NodeJS.ProcessEnv {
  try {
    return parseEnv(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** Name of the environment variable that selects the profile. */
export const PROFILE_ENV_VAR = 'DOCS_PROFILE';

export type ProfileName = 'dev' | 'prod';

export type CardanoNetwork = 'preview' | 'mainnet';

export interface BuildProfile {
  /** Profile key, as passed in `DOCS_PROFILE`. */
  readonly name: ProfileName;
  /** Origin the site is served from, without a trailing slash. */
  readonly url: string;
  /** Path prefix every route resolves through. Always ends with a slash. */
  readonly baseUrl: string;
  /** Cardano network this build talks to. */
  readonly network: CardanoNetwork;
  /** GitHub owner of the repository this build is published from. */
  readonly organizationName: string;
  /** GitHub repository name. */
  readonly projectName: string;
  /**
   * Repository this build's content is edited in. The developer profile points at the fork and
   * production at upstream, so an "edit this page" link never sends a reader to the wrong repo.
   */
  readonly repoUrl: string;
  /**
   * Host written into the Pages `CNAME` file, or `null` when the build must not carry one.
   * A `CNAME` in the developer output would send the fork's site to production's host (ENV-6).
   */
  readonly cname: string | null;
  /** Whether search engines may index this build. Consumed by the ENV-3 guards (B05). */
  readonly indexable: boolean;
}

/** Browser consumers need environment values, not duplicate deployment/repository metadata. */
export type ClientBuildProfile = Pick<
  BuildProfile,
  'url' | 'baseUrl' | 'network' | 'repoUrl' | 'indexable'
>;
export function clientProfile({
  url,
  baseUrl,
  network,
  repoUrl,
  indexable,
}: BuildProfile): ClientBuildProfile {
  return {url, baseUrl, network, repoUrl, indexable};
}

export const PROFILES: Readonly<Record<ProfileName, BuildProfile>> = Object.freeze({
  dev: Object.freeze({
    name: 'dev',
    url: 'https://lidonation.github.io',
    baseUrl: '/cardano-db-sync/',
    network: 'preview',
    organizationName: 'lidonation',
    projectName: 'cardano-db-sync',
    repoUrl: 'https://github.com/lidonation/cardano-db-sync',
    cname: null,
    indexable: false,
  }),
  prod: Object.freeze({
    name: 'prod',
    url: 'https://dbsync.cardano.intersectmbo.org',
    baseUrl: '/',
    network: 'mainnet',
    organizationName: 'IntersectMBO',
    projectName: 'cardano-db-sync',
    repoUrl: 'https://github.com/IntersectMBO/cardano-db-sync',
    cname: 'dbsync.cardano.intersectmbo.org',
    indexable: true,
  }),
});

export const PROFILE_NAMES: readonly ProfileName[] = Object.freeze(
  Object.keys(PROFILES) as ProfileName[],
);

export function isProfileName(value: unknown): value is ProfileName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, value);
}

/**
 * Resolve the active profile from the environment.
 *
 * Throws when the variable is missing or unrecognised. There is deliberately no default: a build
 * that silently picks a profile is a build that can publish the developer site to production's
 * host, or ship a mainnet wallet prompt on preview data.
 */
export function resolveProfile(env: NodeJS.ProcessEnv = process.env): BuildProfile {
  const raw = env[PROFILE_ENV_VAR];

  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `${PROFILE_ENV_VAR} is not set. Set it to one of: ${PROFILE_NAMES.join(', ')}. ` +
        `Use "npm run build:dev" or "npm run build:prod" rather than calling docusaurus directly.`,
    );
  }

  const name = raw.trim();

  if (!isProfileName(name)) {
    throw new Error(
      `${PROFILE_ENV_VAR}="${name}" is not a known profile. Expected one of: ${PROFILE_NAMES.join(', ')}.`,
    );
  }

  if (name !== 'dev') return PROFILES[name];

  // Only the dev profile is overridable; production URL, CNAME and base path stay fixed.
  // Explicit environments (tests/tools) are deterministic; the normal config reads docs/.env.
  const fileEnv = env === process.env ? readDocsEnv() : {};
  const devUrl = (env.DOCS_DEV_URL ?? fileEnv.DOCS_DEV_URL)?.trim();
  // The base path override is for the dev server only (`docusaurus start` runs with
  // NODE_ENV=development), so dev builds and their gates keep the published route prefix.
  const devBase =
    env.NODE_ENV === 'development'
      ? (env.DOCS_DEV_BASE_URL ?? fileEnv.DOCS_DEV_BASE_URL)?.trim()
      : undefined;
  if (!devUrl && !devBase) return PROFILES.dev;

  return Object.freeze({
    ...PROFILES.dev,
    ...(devUrl ? {url: parseDevOrigin(devUrl)} : {}),
    ...(devBase ? {baseUrl: parseDevBase(devBase)} : {}),
  });
}

const DEV_URL_ERROR =
  'DOCS_DEV_URL must be an HTTP(S) origin, without credentials, path, query or hash.';

function parseDevOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(DEV_URL_ERROR);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(DEV_URL_ERROR);
  }
  return url.origin;
}

/** A root-relative path that starts and ends with `/`, e.g. `/` or `/preview/`. */
function parseDevBase(value: string): string {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value)) {
    throw new Error('DOCS_DEV_BASE_URL must be a path that starts and ends with "/", e.g. "/".');
  }
  return value;
}
