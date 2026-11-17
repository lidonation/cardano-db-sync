/** B22's shared page/RSS/Atom dataset. Dates are UTC YYYY-MM-DD; links are HTTPS.
 * IDs are source identities (`release:<tag>` or `<kind>:<commit SHA>`), not list positions.
 * asOf is the latest source date, never the build clock, so identical history regenerates exactly.
 */
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
