import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

import {extractAllSourceCodeFileTranslations} from '@docusaurus/babel';
import {expect, it} from 'vitest';

const require = createRequire(import.meta.url);
it('exports every Numbers message to the actual Docusaurus translation catalog', async () => {
  const file = path.resolve(import.meta.dirname, '../../src/numbers/messages.ts');
  const expected = [...readFileSync(file, 'utf8').matchAll(/id: '([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  expect(expected.length).toBeGreaterThan(30);
  const [result] = await extractAllSourceCodeFileTranslations([file], {
    presets: [require.resolve('@babel/preset-typescript')],
  });
  expect(result.warnings).toEqual([]);
  expect(Object.keys(result.translations).sort()).toEqual(expected);
});
