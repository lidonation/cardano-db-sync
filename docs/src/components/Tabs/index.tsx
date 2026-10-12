import React, {useId, useRef, useState, type KeyboardEvent, type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';

import Retry from '../shared/Retry';
import {EmptyState, ErrorMessage, Skeleton, VisuallyHidden, loadingLabel} from '../shared/Status';
import {demoAttributes, type DataStatus, type InteractionState} from '../shared/states';

import {nextTab, resolveSelected} from './keyboard';
import styles from './styles.module.css';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly disabled?: boolean;
  /** The panel's data state (DF-4): a view can fail or be empty on its own. */
  readonly status?: DataStatus;
  readonly errorMessage?: ReactNode;
  readonly onRetry?: () => void;
  readonly emptyMessage?: ReactNode;
}

export interface TabsProps {
  /** Names the group (`aria-label`). */
  readonly label: string;
  readonly items: readonly TabItem[];
  /**
   * `chip` is `Chip / Filter` (the Updates Week/Month/Total/Custom filter); `underline` is the
   * DF-9 install-method tab (Docker / nix / cabal).
   */
  readonly appearance?: 'chip' | 'underline';
  readonly defaultSelected?: string;
  readonly onSelect?: (id: string) => void;
  /** Shown instead of the tablist when there is nothing to choose between. */
  readonly emptyMessage?: ReactNode;
  /** Pins an interaction state on one tab, for the inventory. */
  readonly demo?: {readonly tab: string; readonly state: InteractionState};
}

/**
 * A tab group with the full ARIA pattern (A11Y-28): `tablist` / `tab` / `tabpanel`, one tab stop
 * into the group (roving `tabIndex`), arrow keys move and activate, Home and End jump, disabled
 * tabs are skipped. Selection is shown by shape — a filled chip or a 3px bar under the label —
 * as well as colour (FLOOR-6). Each panel carries its own loading, error and empty states.
 */
export default function Tabs({
  label,
  items,
  appearance = 'chip',
  defaultSelected,
  onSelect,
  emptyMessage,
  demo,
}: TabsProps): React.JSX.Element {
  const base = useId();
  const [requested, setSelected] = useState(defaultSelected);
  const selected = resolveSelected(items, requested);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // The chip appearance is the `Chip / Filter` definition; the underline appearance is the DF-2
  // "tab" control, the same component in another dress.
  const marker =
    appearance === 'chip' ? {'data-dbs-component': 'Chip / Filter'} : {'data-dbs-control': 'Tab'};

  if (items.length === 0) {
    return (
      <div {...marker} data-status="empty">
        <EmptyState>
          {emptyMessage ??
            translate({
              id: 'components.tabs.empty',
              message: 'No views to show yet.',
              description: 'Tab group with no tabs',
            })}
        </EmptyState>
      </div>
    );
  }

  const select = (id: string) => {
    setSelected(id);
    onSelect?.(id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.id === selected);
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const target = nextTab(
      event.key,
      current,
      items.map((item) => !item.disabled),
      {rtl},
    );
    if (target === null) {
      return;
    }
    event.preventDefault();
    select(items[target].id);
    tabs.current[target]?.focus();
  };

  return (
    <div className={styles.tabs} data-appearance={appearance} {...marker}>
      <div className={styles.list} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item, index) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              className={styles.tab}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-controls={`${base}-panel-${item.id}`}
              aria-selected={isSelected}
              aria-disabled={item.disabled || undefined}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => !item.disabled && select(item.id)}
              {...demoAttributes(demo?.tab === item.id ? demo.state : undefined)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className={styles.panel}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          aria-busy={item.status === 'loading' || undefined}
          hidden={item.id !== selected}
          tabIndex={0}
        >
          <Panel item={item} />
        </div>
      ))}
    </div>
  );
}

function Panel({item}: {readonly item: TabItem}): React.JSX.Element {
  switch (item.status ?? 'ready') {
    case 'loading':
      return (
        <>
          <VisuallyHidden>{loadingLabel()}</VisuallyHidden>
          <Skeleton size="block" />
        </>
      );
    case 'error':
      return (
        <ErrorMessage action={item.onRetry ? <Retry onClick={item.onRetry} /> : undefined}>
          {item.errorMessage}
        </ErrorMessage>
      );
    case 'empty':
      return <EmptyState>{item.emptyMessage}</EmptyState>;
    default:
      return <>{item.content}</>;
  }
}
