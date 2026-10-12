import React, {useId, type MouseEvent, type ReactNode} from 'react';

import Link from '@docusaurus/Link';
import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import {ErrorMessage, VisuallyHidden} from '../shared/Status';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  /** Minimum widths from the design's button scale: sm 130 · md 190 · lg 230. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Renders a link instead of a button. */
  readonly href?: string;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** `Button / Disabled`: stays focusable and discoverable, but does nothing (`aria-disabled`). */
  readonly disabled?: boolean;
  /** The action is running: the control is busy and inert until it settles. */
  readonly loading?: boolean;
  /** Announced while loading. */
  readonly loadingLabel?: string;
  /** The action failed: what went wrong and what to do, shown beside the button. */
  readonly error?: ReactNode;
  readonly demo?: InteractionState;
}

/**
 * `Button / Primary · Secondary · Ghost · Danger · Disabled` — the design's geometric buttons:
 * an elongated hexagon, 44px tall, 12px end-cuts at mid-height (the logo's angles).
 *
 * One component, themed by token (THM-5). Labels on accent and danger fills use
 * `text.on-accent`, which keeps 4.5:1 in every palette — cream's own surface is 4.37:1 on
 * `accent.primary`. Outlined variants draw their boundary in `border.interactive` or the accent,
 * never `border.default`, so the control clears 3:1 against the page (FLOOR-3).
 *
 * States (FLOOR-5): hover, pressed and focus from the pointer and keyboard; disabled; loading
 * (busy, inert, announced); error (a message beside the button, linked by `aria-describedby`).
 * A button has no empty state: it always has a label and an action.
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'sm',
  href,
  type = 'button',
  onClick,
  disabled = false,
  loading = false,
  loadingLabel,
  error,
  demo,
}: ButtonProps): React.JSX.Element {
  const errorId = useId();
  const inert = disabled || loading;
  const common = {
    className: styles.button,
    'data-variant': variant,
    'data-size': size,
    'data-dbs-component': 'Button',
    'aria-disabled': inert || undefined,
    'aria-busy': loading || undefined,
    'aria-describedby': error ? errorId : undefined,
    ...demoAttributes(demo),
    ...(error ? {'data-error': ''} : {}),
  };
  const content = (
    <span className={styles.label}>
      {loading && <Icon name="spinner" size={16} className={styles.spinner} />}
      {children}
    </span>
  );
  const guard = (event: MouseEvent<HTMLElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <>
      {href && !inert ? (
        <Link {...common} to={href} onClick={guard}>
          {content}
        </Link>
      ) : href ? (
        <a {...common} role="link" tabIndex={0}>
          {content}
        </a>
      ) : (
        <button {...common} type={type} onClick={guard}>
          {content}
        </button>
      )}
      {loading && (
        <VisuallyHidden>
          <span role="status">
            {loadingLabel ??
              translate({
                id: 'components.button.loading',
                message: 'Working…',
                description: 'Announced while a button action runs',
              })}
          </span>
        </VisuallyHidden>
      )}
      {error && (
        <ErrorMessage id={errorId} live>
          {error}
        </ErrorMessage>
      )}
    </>
  );
}
