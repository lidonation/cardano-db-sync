import React, {useState} from 'react';

import Link from '@docusaurus/Link';

import {loadingLabel} from '../shared/Retry';
import {Skeleton, VisuallyHidden} from '../shared/Status';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

/** Hexagon widths in the design: core team 88, contributors 92, guide meta 32. */
export type AvatarSize = 'meta' | 'core' | 'contributor';

const WIDTH: Record<AvatarSize, number> = {meta: 32, core: 88, contributor: 92};

/**
 * `Avatar` (was `Avatar / Hexagon`, THM-6: the name now carries no theme or shape costume) — a
 * person, cropped to the design's pointy-top hexagon (height = 2w/√3), themed by token like
 * everything else. When the image is missing (empty) or fails to load (error) it falls back to a
 * flat `accent.primary-tint` hexagon with initials — the precedent from `karknu` — so a broken
 * avatar never leaves a hole. Linked avatars have hover and focus states; the ring is square, around
 * the hexagon's box (DF-3).
 */
export default function Avatar({
  name,
  src,
  href,
  size = 'contributor',
  loading = false,
  demo,
}: {
  readonly name: string;
  readonly src?: string;
  readonly href?: string;
  readonly size?: AvatarSize;
  readonly loading?: boolean;
  readonly demo?: InteractionState;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const width = WIDTH[size];
  const height = Math.round((2 * width) / Math.sqrt(3));
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const status = loading ? 'loading' : !src ? 'empty' : failed ? 'error' : 'ready';
  const face =
    status === 'loading' ? (
      <>
        <VisuallyHidden>{loadingLabel()}</VisuallyHidden>
        <Skeleton size="avatar" shape="hexagon" />
      </>
    ) : status === 'ready' ? (
      <img
        className={styles.image}
        src={src}
        alt={name}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    ) : (
      <span className={styles.fallback}>
        <span aria-hidden="true">{initials}</span>
        <VisuallyHidden>{name}</VisuallyHidden>
      </span>
    );
  const attributes = {
    className: styles.avatar,
    'data-size': size,
    'data-status': status,
    'data-dbs-component': 'Avatar',
    'aria-busy': loading || undefined,
    ...demoAttributes(demo),
  };
  return href ? (
    <Link {...attributes} to={href}>
      {face}
    </Link>
  ) : (
    <span {...attributes}>{face}</span>
  );
}
