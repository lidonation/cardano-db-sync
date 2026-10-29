import type {NumbersSnapshot} from './types';
import {linearScale} from '../components/Chart/scale';

/** Visual coordinates only. Never alters B23's model values; epoch gaps remain proportional. */
export function growthPoints(rows: NonNullable<NumbersSnapshot['storage']>['growth']) {
  const sorted = [...rows].sort((a, b) => a.epoch - b.epoch);
  const first = sorted[0]?.epoch ?? 0;
  const span = Math.max(1, (sorted.at(-1)?.epoch ?? first) - first);
  const max = Math.max(...sorted.map((row) => row.gigabytes), 0) || 1;
  return sorted.map((row) => ({
    ...row,
    x: linearScale(row.epoch, first, first + span, 20, 580),
    y: linearScale(row.gigabytes, 0, max, 160, 20),
  }));
}
