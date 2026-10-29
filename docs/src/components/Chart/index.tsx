import React, {type ReactNode} from 'react';

/** A chart always has a textual summary and an accessible data alternative. */
export default function Chart({
  summaryId,
  summary,
  graphic,
  table,
}: {
  summaryId: string;
  summary: ReactNode;
  graphic: ReactNode;
  table: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <p id={summaryId}>{summary}</p>
      {graphic}
      {table}
    </>
  );
}

/** Shared SVG viewport and accessible name; geometry remains the caller's responsibility. */
export function ChartGraphic({
  summaryId,
  className,
  viewBox,
  children,
}: {
  summaryId: string;
  className: string;
  viewBox: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <svg className={className} viewBox={viewBox} role="img" aria-labelledby={summaryId}>
      {children}
    </svg>
  );
}
