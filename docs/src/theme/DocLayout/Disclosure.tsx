import React, {useId, useState, type ReactNode} from 'react';

import Icon from '../../components/shared/Icon';

import styles from './styles.module.css';

/**
 * A disclosure: a real button that says whether it is expanded (`aria-expanded`) and controls one
 * panel, collapsed by default (NAV-2). Used for "On this section" (the docs sidebar below 768px)
 * and "On this page" (the table of contents below 1280px), as DF-7 draws them.
 */
export default function Disclosure({
  kicker,
  label,
  tone = 'base',
  className,
  children,
}: {
  /** Leading words in the secondary role ("On this section:"). */
  readonly kicker?: ReactNode;
  readonly label: ReactNode;
  readonly tone?: 'base' | 'sunken';
  readonly className?: string;
  /** The panel; given a `close` callback so following a link closes it. */
  readonly children: (close: () => void) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={[styles.disclosure, className].filter(Boolean).join(' ')} data-tone={tone}>
      <button
        type="button"
        className={styles.disclosureButton}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {kicker && <span className={styles.kicker}>{kicker}</span>}
        <span className={styles.disclosureLabel}>{label}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      <div id={id} className={styles.panel} hidden={!open}>
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
