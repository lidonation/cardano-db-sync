import React from 'react';

import styles from './styles.module.css';

const hex = (cx: number, cy: number, r: number): string =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

/**
 * The hero's flat graphic, from the design's `Landing · 1440`: blocks (hexagons) gathering into a
 * PostgreSQL cylinder. Decoration only — hidden from assistive technology, every colour a token.
 */
export default function HeroGraphic(): React.JSX.Element {
  return (
    <svg
      className={styles.graphic}
      viewBox="850 190 480 230"
      aria-hidden="true"
      focusable="false"
      data-dbs-graphic="hero"
    >
      <polygon className={styles.gBrand} points={hex(892, 232, 26.7)} />
      <polygon className={styles.gAccent} points={hex(972, 302, 35)} />
      <polygon className={styles.gOutlineElectric} points={hex(888, 358, 23.3)} />
      <polygon className={styles.gTeal} points={hex(1034, 224, 20)} />
      <polygon className={styles.gTint} points={hex(1040, 350, 16.7)} />
      <polygon className={styles.gOutlineAccent} points={hex(1120, 300, 25)} />
      <rect className={styles.gLine} x="1158" y="298" width="36" height="3" />
      <rect className={styles.gDbBody} x="1200" y="240" width="120" height="120" />
      <ellipse className={styles.gDbBody} cx="1260" cy="360" rx="60" ry="18" />
      <ellipse className={styles.gDbTop} cx="1260" cy="240" rx="60" ry="18" />
      <text className={styles.gLabel} x="1260" y="412" textAnchor="middle">
        PostgreSQL
      </text>
    </svg>
  );
}
