import {expect, it} from 'vitest';
import {releaseTrack} from '../../src/roadmap/releases';
it('groups the tracked release versions into the designed upcoming milestones', () => {
  expect(
    releaseTrack([
      '13.2.0.0',
      '13.5.0.0',
      '13.5.0.2',
      '13.6.0.1',
      '13.7.0.1',
      '13.7.1.1',
      '14.0.0.0',
    ]),
  ).toEqual(['13.5', '13.6', '13.7.0', '13.7.1', '14.0']);
});
