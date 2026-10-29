export type GuideLocks = {
  guides?: Record<string, Record<string, unknown>>;
  ranges?: Record<string, string[]>;
  variants?: Record<string, Record<string, string[]>>;
};
export function guidesForTable(artifact: GuideLocks, table: string): string[];
export function versionsForGuide(artifact: GuideLocks, guide: string): string[];
export function variantsForGuide(artifact: GuideLocks, guide: string): Record<string, string[]>;
