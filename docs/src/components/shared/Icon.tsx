import React from 'react';

/**
 * The drawn icon set (CONTENT-2, FLOOR-8): every glyph is a path in the design file's own
 * hexagon-and-line language — 1.5px strokes, square caps, mitred joins — never an emoji or a
 * unicode character standing in for an icon. Icons are decorative (`aria-hidden`); the control
 * that holds one carries the accessible name. Colour is `currentColor`, so an icon always takes
 * its text token.
 */
export type IconName =
  | 'hexagon'
  | 'logo'
  | 'check'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'external'
  | 'enter'
  | 'alert'
  | 'copy'
  | 'plus'
  | 'minus'
  | 'search'
  | 'menu'
  | 'close'
  | 'github'
  | 'spinner';

const PATHS: Record<IconName, React.ReactNode> = {
  hexagon: <path d="M8 1 14 4.5v7L8 15l-6-3.5v-7z" fill="currentColor" stroke="none" />,
  logo: (
    <>
      <path d="M8 1.5 13.6 4.75v6.5L8 14.5l-5.6-3.25v-6.5z" fill="none" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M3 8.5 6.5 12 13 4.5" />,
  'chevron-down': <path d="m4 6 4 4 4-4" />,
  'chevron-up': <path d="m4 10 4-4 4 4" />,
  'arrow-left': <path d="M13 8H3m4-4L3 8l4 4" />,
  'arrow-right': <path d="M3 8h10M9 4l4 4-4 4" />,
  external: <path d="M4 12 12 4M6.5 4H12v5.5" />,
  enter: <path d="M12.5 3v6.5h-9m3-3-3 3 3 3" />,
  alert: (
    <>
      <path d="M8 2 14.5 13.5h-13z" />
      <path d="M8 6.5V10M8 11.25v1" />
    </>
  ),
  copy: (
    <>
      <path d="M5.5 5.5h7v7h-7z" />
      <path d="M3.5 10.5v-7h7" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.5 3.5" />
    </>
  ),
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  close: <path d="m3.5 3.5 9 9m0-9-9 9" />,
  github: (
    <path
      d="M8 1.2a6.8 6.8 0 0 0-2.15 13.25c.34.06.46-.15.46-.33v-1.15c-1.9.41-2.3-.92-2.3-.92-.31-.79-.76-1-.76-1-.62-.42.05-.41.05-.41.68.05 1.04.7 1.04.7.61 1.04 1.6.74 1.99.57.06-.44.24-.74.43-.91-1.51-.17-3.1-.76-3.1-3.37 0-.74.27-1.35.7-1.83-.07-.17-.3-.87.07-1.8 0 0 .57-.19 1.87.7a6.5 6.5 0 0 1 3.4 0c1.3-.89 1.87-.7 1.87-.7.37.93.14 1.63.07 1.8.44.48.7 1.09.7 1.83 0 2.62-1.6 3.2-3.11 3.37.24.21.46.62.46 1.25v1.86c0 .18.12.4.47.33A6.8 6.8 0 0 0 8 1.2z"
      fill="currentColor"
      stroke="none"
    />
  ),
  spinner: <path d="M8 1.5 13.6 4.75v6.5L8 14.5l-5.6-3.25v-6.5z" strokeDasharray="22 14" />,
};

export interface IconProps {
  readonly name: IconName;
  /** One of the icon scale steps (`--dbs-icon-*`): 12, 16, 24, 32. */
  readonly size?: 12 | 16 | 24 | 32;
  readonly className?: string;
}

export default function Icon({name, size = 16, className}: IconProps): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
