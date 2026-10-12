declare module '@generated/survey-results/default/resolved.json' {
  const resolved: import('./types').ResolvedAggregate;
  export default resolved;
}

declare module '@generated/survey-results/default/view' {
  const view: (props: import('./Dashboard').DashboardViewProps) => import('react').JSX.Element;
  export default view;
}
