import React, {useId, type ChangeEvent, type ReactNode} from 'react';

import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import {ErrorMessage} from '../shared/Status';

import Frame, {CardSkeleton, type CardDataProps} from './Frame';
import styles from './styles.module.css';

interface SelectCardProps extends CardDataProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly name: string;
  readonly value: string;
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly disabled?: boolean;
  /** A validation message for this choice: why it cannot stand and what to do (DF-4). */
  readonly error?: ReactNode;
}

/**
 * The selectable cards are real form controls: a native checkbox or radio inside the card's
 * label, visually hidden but focused and announced as itself (A11Y-17, 4.1.2). The card paints the
 * control's states — hover, pressed, focus (ring on the whole card), selected (a 2px
 * `border.selected` boundary plus a drawn tick, never colour alone: FLOOR-6), disabled, and error
 * (danger boundary plus the message beside it, linked by `aria-describedby`).
 */
function SelectFrame({
  kind,
  type,
  role,
  label,
  description,
  name,
  value,
  checked,
  defaultChecked,
  onChange,
  disabled,
  error,
  indicator,
  layout,
  ...data
}: SelectCardProps & {
  readonly kind: 'Choice' | 'Option' | 'Data option';
  readonly type: 'checkbox' | 'radio';
  readonly role?: 'switch';
  readonly indicator: ReactNode;
  readonly layout: string;
}): React.JSX.Element {
  const errorId = useId();
  const status = data.status ?? 'ready';
  if (status !== 'ready') {
    return (
      <Frame
        kind={kind}
        skeleton={kind === 'Option' ? <CardSkeleton icon /> : <CardSkeleton />}
        {...data}
      >
        {null}
      </Frame>
    );
  }
  return (
    <div className={styles.selectWrap}>
      <label
        className={`${styles.card} ${styles.select} ${layout}`}
        data-kind={kind}
        data-dbs-component={`Card / ${kind}`}
        data-dbs-demo={data.demo}
        data-error={error ? '' : undefined}
      >
        <input
          className={styles.input}
          type={type}
          role={role}
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {indicator}
        <span className={styles.selectText}>
          <span className={styles.title}>{label}</span>
          {description && <span className={styles.body}>{description}</span>}
        </span>
      </label>
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </div>
  );
}

/** `Card / Choice` — one of several that may all be picked (survey step 2): a checkbox card. */
export function ChoiceCard(props: SelectCardProps): React.JSX.Element {
  return (
    <SelectFrame
      {...props}
      kind="Choice"
      type="checkbox"
      layout={styles.choice}
      indicator={
        <span className={styles.tick} aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      }
    />
  );
}

/** `Card / Option` — exactly one of several (survey steps 1 and 3): a radio card with an icon. */
export function OptionCard({
  icon,
  ...props
}: SelectCardProps & {readonly icon?: ReactNode}): React.JSX.Element {
  return (
    <SelectFrame
      {...props}
      kind="Option"
      type="radio"
      layout={styles.option}
      indicator={
        <>
          <span className={styles.optionIcon} aria-hidden="true">
            {icon ?? <Icon name="hexagon" size={32} />}
          </span>
          <span className={styles.tick} aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
        </>
      }
    />
  );
}

/**
 * `Card / Data option` — a data group the config builder can switch on (config step 2): a
 * `role="switch"` checkbox. The state is the knob's position and the word beside it, never the
 * track colour alone (FLOOR-6); the track keeps a 3:1 boundary in both positions (FLOOR-3).
 */
export function DataOptionCard({
  configKey,
  tables,
  ...props
}: Omit<SelectCardProps, 'description'> & {
  readonly configKey: string;
  readonly tables: string;
}): React.JSX.Element {
  return (
    <SelectFrame
      {...props}
      kind="Data option"
      type="checkbox"
      role="switch"
      layout={styles.dataOption}
      description={
        <>
          <code className={styles.configKey}>{configKey}</code>
          <code className={styles.tables}>{tables}</code>
        </>
      }
      indicator={
        <span className={styles.switch} aria-hidden="true">
          <span className={styles.track}>
            <span className={styles.knob} />
          </span>
          <span className={styles.switchWord} data-word="on">
            {translate({id: 'components.switch.on', message: 'On', description: 'Switch state'})}
          </span>
          <span className={styles.switchWord} data-word="off">
            {translate({id: 'components.switch.off', message: 'Off', description: 'Switch state'})}
          </span>
        </span>
      }
    />
  );
}
