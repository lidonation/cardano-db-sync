import {readFileSync} from 'node:fs';
import path from 'node:path';
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
  it('runs executable regression tests before extraction', () => {
    expect(workflow).toContain('cabal test');
    expect(workflow).toContain('sh test/cli.sh');
  });
  it('extracts the rename map from schema/ and gates its drift (B09)', () => {
    expect(workflow).toContain('- "schema/**"');
    expect(workflow).toContain('extractor=$(cabal list-bin extract-renames)');
    expect(workflow).toContain('git diff --quiet -- docs/generated/schema-renames.json');
  });
});
