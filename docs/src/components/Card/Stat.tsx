import React, {type ReactNode} from 'react';
import {Skeleton} from '../shared/Status';
import Frame, {type CardDataProps} from './Frame';
import statStyles from './stat.module.css';

/**
 * `Card / Stat` — one measured figure, its share as a bar, and a detail line. The bar is an SVG
 * rect sized by attribute: the CSP forbids inline styles (SEC-2), and nothing animates a layout
 * property (PERF-3). The figure itself is in the text, so the bar is decorative.
 */
export function StatCard({
  label,
  value,
  fraction,
  detail,
  ...data
}: CardDataProps & {
  readonly label: ReactNode;
  readonly value: ReactNode;
  /** 0–1: how much of the bar is filled. */
  readonly fraction?: number;
  readonly detail?: ReactNode;
}): React.JSX.Element {
  const share = fraction === undefined ? undefined : Math.min(1, Math.max(0, fraction));
  return (
    <Frame
      kind="Stat"
      skeleton={
        <>
          <Skeleton size="line-short" />
          <Skeleton size="value" />
          <Skeleton size="line" />
        </>
      }
      {...data}
    >
      <span className={statStyles.label}>{label}</span>
      <span className={statStyles.value}>{value}</span>
      {share !== undefined && (
        <svg
          className={statStyles.bar}
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect className={statStyles.barTrack} x="0" y="0" width="100" height="8" />
          <rect className={statStyles.barFill} x="0" y="0" width={share * 100} height="8" />
        </svg>
      )}
      {detail && <span className={statStyles.detail}>{detail}</span>}
    </Frame>
  );
}
