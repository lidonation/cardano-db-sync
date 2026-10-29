import React, {Children, isValidElement, type ReactNode} from 'react';
import Tabs from '../Tabs';
import styles from './styles.module.css';
import {procedureId} from './ids';

type TabProps = {readonly label: string; readonly children?: ReactNode};

/** Marker consumed by ProcedureTabs; content stays ordinary Markdown in the source. */
export function ProcedureTab({children}: TabProps): React.JSX.Element {
  return <>{children}</>;
}

export function ProcedureTabs({children}: {readonly children?: ReactNode}): React.JSX.Element {
  const items = Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement<TabProps>(child) || typeof child.props.label !== 'string') return [];
    return [{id: procedureId(index), label: child.props.label, content: child.props.children}];
  });
  return <Tabs label="Procedure options" appearance="underline" items={items} />;
}

export function GuideAlert({
  kind,
  children,
}: {
  readonly kind: string;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <aside className={styles.alert} data-kind={kind} aria-label={kind.toUpperCase()}>
      <strong>{kind.toUpperCase()}</strong>
      {children}
    </aside>
  );
}
