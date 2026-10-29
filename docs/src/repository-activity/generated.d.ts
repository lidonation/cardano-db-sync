declare module '@generated/repository-activity/default/resolved.json' {
  const state: import('./types').RepositoryState;
  export default state;
}

/** B53/B54 may import the complete, location-free snapshot when they build their charts. */
declare module '@generated/repository-activity/default/history.json' {
  const state: import('./types').RepositorySnapshotState;
  export default state;
}
