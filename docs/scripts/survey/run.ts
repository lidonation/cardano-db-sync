import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {format} from 'prettier';
import {acquire} from './provider';
import {PROFILES} from '../../config/profiles';
import {tally} from './tally';
import type {ChainInput, Network, TallyArtifact, TallyConfig} from './types';

interface Configuration {
  surveys: TallyConfig['surveys'];
  approvedText: string[];
}
export function configuration(value: unknown, network: Network): TallyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid tally configuration');
  const c = value as Configuration;
  if (
    !Array.isArray(c.surveys) ||
    !Array.isArray(c.approvedText) ||
    c.surveys.some(
      (s) =>
        !s ||
        !/^[a-f0-9]{64}#(0|[1-9][0-9]{0,4})$/.test(s.surveyRef) ||
        Number(s.surveyRef.split('#')[1]) > 65535 ||
        !Number.isSafeInteger(s.endEpoch) ||
        s.endEpoch < 1,
    ) ||
    new Set(c.surveys.map((s) => s.surveyRef)).size !== c.surveys.length ||
    c.approvedText.some(
      (id) =>
        typeof id !== 'string' ||
        !new RegExp(`^${network}:[a-f0-9]{64}:[0-9]+:[0-9]+:[a-f0-9]{64}$`).test(id),
    )
  )
    throw new Error('Invalid reviewed survey reference/moderation configuration');
  return {network, surveys: c.surveys, approvedText: c.approvedText};
}
export interface InactiveArtifact {
  network: Network;
  generatedAt: null;
  tip: null;
  surveys: [];
  audit: [];
}
const origins = {
  preview: [PROFILES.dev.url],
  mainnet: [PROFILES.prod.url],
};
/** Atomic per-network write; failures leave its previous aggregate intact. */
export async function runNetwork(
  root: string,
  network: Network,
  env = process.env,
  source: typeof acquire = acquire,
): Promise<'unconfigured' | 'updated' | 'unchanged'> {
  const configs = JSON.parse(await readFile(path.join(root, 'config/survey-tally.json'), 'utf8'));
  const config = configuration(configs[network], network);
  let artifact: TallyArtifact | InactiveArtifact;
  if (!config.surveys.length)
    artifact = {network, generatedAt: null, tip: null, surveys: [], audit: []};
  else {
    const key = env[`BLOCKFROST_${network.toUpperCase()}_PROJECT_ID`];
    if (!key) throw new Error('Configured survey requires its network provider credential');
    const input: ChainInput = await source(config, key, origins[network]);
    artifact = tally(input, config);
  }
  const content = await format(JSON.stringify(artifact), {parser: 'json'});
  const file = path.join(root, `generated/survey-${network}/aggregate.json`);
  let previous: string | undefined;
  try {
    previous = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (content === previous) return config.surveys.length ? 'unchanged' : 'unconfigured';
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
  return config.surveys.length ? 'updated' : 'unconfigured';
}
export async function main(
  root = process.cwd(),
  networks: Network[] = ['preview', 'mainnet'],
  env = process.env,
  out = console,
): Promise<boolean> {
  let failed = false;
  for (const network of networks) {
    try {
      out.log(`Survey ${network}: ${await runNetwork(root, network, env)}`);
    } catch {
      failed = true;
      out.error(`Survey ${network}: failed; previous aggregate retained`);
    }
  }
  return !failed;
}
if (require.main === module) {
  const network = process.argv[2];
  if (network && network !== 'preview' && network !== 'mainnet') {
    console.error('Usage: survey:tally [preview|mainnet]');
    process.exitCode = 1;
  } else
    main(process.cwd(), network ? [network as Network] : undefined).then(
      (ok) => {
        if (!ok) process.exitCode = 1;
      },
      () => {
        process.exitCode = 1;
      },
    );
}
