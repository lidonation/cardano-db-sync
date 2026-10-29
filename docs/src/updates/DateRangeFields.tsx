import React, {useId} from 'react';

import {ErrorMessage} from '../components/shared/Status';
import {rangeError} from './model';
import type {DateRange} from './types';
import styles from './styles.module.css';

interface RangeMessages {
  readonly from: string;
  readonly to: string;
  readonly utc: string;
  readonly required: string;
  readonly invalid: string;
  readonly reversed: string;
}

/** Shared inclusive UTC date controls for curated updates and repository commits. */
export default function DateRangeFields({
  range,
  onChange,
  messages,
}: {
  readonly range: DateRange;
  readonly onChange: (range: DateRange) => void;
  readonly messages: RangeMessages;
}): React.JSX.Element {
  const base = useId();
  const error = rangeError(range);
  return (
    <div className={styles.range}>
      <div className={styles.fields}>
        {(['from', 'to'] as const).map((endpoint) => (
          <label className="dbs-type-label" key={endpoint} htmlFor={`${base}-${endpoint}`}>
            {messages[endpoint]}
            <input
              className="dbs-type-body-sm"
              id={`${base}-${endpoint}`}
              type="date"
              value={range[endpoint]}
              aria-invalid={(error !== null && error !== 'required') || undefined}
              aria-describedby={`${base}-utc${error ? ` ${base}-error` : ''}`}
              onChange={(event) => onChange({...range, [endpoint]: event.currentTarget.value})}
            />
          </label>
        ))}
      </div>
      <p id={`${base}-utc`} className={styles.helper}>
        {messages.utc}
      </p>
      {error === 'required' ? (
        <p id={`${base}-error`} className={styles.helper}>
          {messages.required}
        </p>
      ) : error ? (
        <ErrorMessage id={`${base}-error`} live>
          {messages[error]}
        </ErrorMessage>
      ) : null}
    </div>
  );
}
