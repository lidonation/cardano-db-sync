import React from 'react';

import styles from './styles.module.css';

const hex = (cx: number, cy: number, r: number): string =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');

/** The same flat PostgreSQL cylinder is used by the hero and pipeline. */
export function DatabaseCylinder(): React.JSX.Element {
  return (
    <g>
      <rect className={styles.gDbBody} x="1200" y="240" width="120" height="120" />
      <ellipse className={styles.gDbBody} cx="1260" cy="360" rx="60" ry="18" />
      <ellipse className={styles.gDbTop} cx="1260" cy="240" rx="60" ry="18" />
    </g>
  );
}

/**
 * The hero's flat graphic, from the design's `Landing · 1440`: blocks (hexagons) gathering into a
 * PostgreSQL cylinder. Decoration only - hidden from assistive technology, every colour a token.
 */
export default function HeroGraphic(): React.JSX.Element {
  return (
    <svg
      className={styles.graphic}
      viewBox="820 190 500 230"
      aria-hidden="true"
      focusable="false"
      data-dbs-graphic="hero"
    >
      <defs>
        <clipPath id="landing-hex-electric">
          <polygon points={hex(888, 358, 23.3)} />
        </clipPath>
        <clipPath id="landing-hex-accent">
          <polygon points={hex(1120, 300, 25)} />
        </clipPath>
      </defs>
      <polygon className={styles.gBrand} points={hex(892, 232, 26.7)} />
      <polygon className={styles.gAccent} points={hex(972, 302, 35)} />
      <polygon
        className={styles.gOutlineElectric}
        clipPath="url(#landing-hex-electric)"
        points={hex(888, 358, 23.3)}
      />
      <polygon className={styles.gTeal} points={hex(1034, 224, 20)} />
      <polygon className={styles.gTint} points={hex(1040, 350, 16.7)} />
      <polygon
        className={styles.gOutlineAccent}
        clipPath="url(#landing-hex-accent)"
        points={hex(1120, 300, 25)}
      />
      <rect className={styles.gLine} x="1158" y="298" width="36" height="3" />
      <DatabaseCylinder />
      <text className={`dbs-type-eyebrow ${styles.gLabel}`} x="1260" y="412" textAnchor="middle">
        PostgreSQL
      </text>
    </svg>
  );
}
