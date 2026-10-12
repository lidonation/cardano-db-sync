/** B22's build-produced feed. Dates are UTC YYYY-MM-DD; links are absolute HTTPS URLs. */
export interface UpdateEntry {
  readonly id: string;
  readonly date: string;
  readonly kind: 'release' | 'schema' | 'docs';
  readonly title: string;
  readonly url: string;
}
export interface UpdatesFeed {
  readonly asOf: string;
  readonly entries: readonly UpdateEntry[];
}
export type Period = 'week' | 'month' | 'total' | 'custom';
export interface DateRange {
  readonly from: string;
  readonly to: string;
}
