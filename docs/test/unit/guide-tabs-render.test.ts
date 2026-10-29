import {expect, it} from 'vitest';
import {procedureId} from '../../src/components/GuideMarkdown/ids';

it('uses stable whitespace-free identifiers independent of the visible label', () => {
  const ids = [procedureId(0), procedureId(1), procedureId(2)];
  expect(new Set(ids).size).toBe(3);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
});
