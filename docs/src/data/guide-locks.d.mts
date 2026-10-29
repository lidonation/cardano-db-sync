export type GuideLocks = {
  guides?: Record<string, Record<string, unknown>>;
  ranges?: Record<string, string[]>;
};
export function guidesForTable(artifact: GuideLocks, table: string): string[];
export function versionsForGuide(artifact: GuideLocks, guide: string): string[];
