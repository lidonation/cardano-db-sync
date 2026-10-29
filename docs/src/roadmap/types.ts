/** Only validated, aggregated public project data is sent to the site. */
export interface RoadmapObjective {
  readonly name: string;
  readonly done: number;
  readonly total: number;
}
export interface RoadmapData {
  readonly version: 1;
  readonly builtAt: string;
  readonly statuses: {readonly todo: number; readonly inProgress: number; readonly done: number};
  readonly objectives: readonly RoadmapObjective[];
  readonly releases: readonly string[];
}
export type RoadmapState =
  {readonly status: 'available'; readonly data: RoadmapData} | {readonly status: 'unavailable'};
