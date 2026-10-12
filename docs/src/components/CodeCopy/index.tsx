import React, {useEffect, useRef, useState} from 'react';

import {translate} from '@docusaurus/Translate';

import Icon from '../shared/Icon';
import {demoAttributes, type InteractionState} from '../shared/states';

import styles from './styles.module.css';

export type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

/**
 * `Code / Copy` — copies a code block's text (DF-4: every Copy button confirms). It sits on the
 * theme-invariant code surface, so it uses the `code.*` roles in every palette (THM-6: correctly
 * invariant). Its boundary is `code.text-muted`: `code.border` is 1.55:1 on `code.surface`
 * (FLOOR-3). The outcome is said in a word and a glyph beside the button and announced through a
 * polite live region; "Copied" reverts after two seconds. With nothing to copy it renders nothing
 * (its empty state); `disabled` covers a block whose text is not ready.
 */
export default function CodeCopy({
  text,
  disabled = false,
  state: pinned,
  demo,
}: {
  readonly text: string;
  readonly disabled?: boolean;
  /** Pins the outcome, for the inventory. */
  readonly state?: CopyState;
  readonly demo?: InteractionState;
}): React.JSX.Element | null {
  const [live, setLive] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const state = pinned ?? live;
  if (text === '') {
    return null;
  }
  const copy = async () => {
    if (disabled || state === 'copying') {
      return;
    }
    setLive('copying');
    try {
      await navigator.clipboard.writeText(text);
      setLive('copied');
    } catch {
      setLive('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLive('idle'), 2000);
  };
  const words: Record<CopyState, string> = {
    idle: translate({
      id: 'components.copy.idle',
      message: 'Copy',
      description: 'Copy button label',
    }),
    copying: translate({
      id: 'components.copy.copying',
      message: 'Copying',
      description: 'Copy in progress',
    }),
    copied: translate({
      id: 'components.copy.copied',
      message: 'Copied',
      description: 'Copy succeeded',
    }),
    failed: translate({
      id: 'components.copy.failed',
      message: 'Copy failed: select the text instead',
      description: 'Copy failed, with the way round it',
    }),
  };
  return (
    <span className={styles.wrap} data-dbs-component="Code / Copy">
      <button
        type="button"
        className={styles.copy}
        data-state={state}
        aria-disabled={disabled || state === 'copying' || undefined}
        aria-busy={state === 'copying' || undefined}
        onClick={copy}
        {...demoAttributes(demo)}
      >
        <Icon
          name={state === 'copied' ? 'check' : state === 'failed' ? 'alert' : 'copy'}
          size={12}
        />
        <span>{state === 'copying' || state === 'copied' ? words[state] : words.idle}</span>
      </button>
      {/* The live region is always present so the outcome is announced; "Copied" is already on
          the button, so only the failure is also shown in words beside it. */}
      <span className={styles.status} role="status" data-state={state}>
        {state === 'copied' || state === 'failed' ? words[state] : ''}
      </span>
    </span>
  );
}
