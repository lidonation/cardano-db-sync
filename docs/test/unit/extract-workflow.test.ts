import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';

const workflow = readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/extract-haddock.yml'),
  'utf8',
);
describe('Haddock extraction workflow (CON-2)', () => {
  it('checks drift on every event without committing repairs', () => {
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain(
      'git ls-files --error-unmatch docs/generated/haddock-annotations.json',
    );
    expect(workflow).not.toContain('git commit');
    expect(workflow).not.toContain('git push');
    expect(workflow).toContain('git diff --quiet -- docs/generated/haddock-annotations.json');
  });
  it('extracts both source inputs under an enforced runtime budget', () => {
    expect(workflow).toContain('--input cardano-db/src');
    expect(workflow).toContain('--input cardano-db-sync/src/Cardano/DbSync/Config/Types.hs');
    expect(workflow).toContain('timeout 60s "$extractor"');
    expect(workflow).toContain('shell: bash');
  });
  it('extracts and watches the reference-bearing source files', () => {
    const doc = yaml.load(workflow) as ExtractionWorkflow;
    const inputs = [
      'cardano-db-sync/app/cardano-db-sync.hs',
      'cardano-db-sync/app/http-get-json-metadata.hs',
      'cardano-db-sync/app/test-http-get-json-metadata.hs',
      'cardano-db-sync/src/Cardano/DbSync/OffChain/Http.hs',
      'cardano-db-sync/src/Cardano/DbSync/OffChain/FetchQueue.hs',
      'cardano-smash-server/src/Cardano/SMASH/Server/Api.hs',
    ];
    for (const input of inputs) {
      expect(workflow).toContain(`--input ${input}`);
      for (const event of ['push', 'pull_request'] as const) {
        expect(doc.on[event].paths).toContain(input);
      }
    }
  });
  it('runs executable regression tests before extraction', () => {
    expect(workflow).toContain('cabal test');
    expect(workflow).toContain('sh test/cli.sh');
    expect(workflow).toContain('sh test/renames-cli.sh');
  });
  it('extracts the rename map from schema/ and gates its drift (B09)', () => {
    expect(workflow).toContain('- "schema/**"');
    expect(workflow).toContain('extractor=$(cabal list-bin extract-renames)');
    expect(workflow).toContain('git diff --quiet -- docs/generated/schema-renames.json');
  });
});

interface ExtractionWorkflow {
  on: Record<'push' | 'pull_request', {paths: string[]}>;
  jobs: {extract: {steps: {name?: string; run?: string; shell?: string}[]}};
}

describe('rename extraction integration', () => {
  it('covers SQL inputs on both events and enforces both artifact drift gates', () => {
    const doc = yaml.load(workflow) as ExtractionWorkflow;
    for (const event of ['push', 'pull_request'] as const) {
      expect(doc.on[event].paths).toContain('schema/**');
      expect(doc.on[event].paths).toContain('docs/extractor/**');
      expect(doc.on[event].paths).toContain('docs/generated/**');
    }
    const steps = doc.jobs.extract.steps;
    const extraction = steps.find((step) =>
      step.run?.includes('--out ../generated/schema-renames.json'),
    );
    expect(extraction?.shell).toBe('bash');
    expect(extraction?.run).toContain('timeout 60s');
    for (const artifact of ['haddock-annotations.json', 'schema-renames.json']) {
      const drift = steps.find((step) =>
        step.run?.includes('git diff --quiet -- docs/generated/' + artifact),
      );
      expect(drift?.run).toContain('git ls-files --error-unmatch docs/generated/' + artifact);
      expect(drift?.run).toContain('exit 1');
    }
  });
  it('keeps schema and rename validation in the docs job and local verify command', () => {
    const site = readFileSync(
      path.resolve(import.meta.dirname, '../../../.github/workflows/docs-site.yml'),
      'utf8',
    );
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    );
    for (const gate of ['check:renames', 'check:schema']) {
      expect(site).toContain('run: npm run ' + gate);
      expect(pkg.scripts.verify).toContain('npm run ' + gate);
    }
  });
});
