import React from 'react';
import Layout from '@theme/Layout';
import {ToolGrid} from '../../../src/ecosystem/Ecosystem';
import {MAIN_CONTENT_ID} from '../../../src/lib/accessibility';

export default function EmptyFixture(): React.JSX.Element {
  return <Layout title="Empty ecosystem fixture"><main id={MAIN_CONTENT_ID} tabIndex={-1}><h1>Empty ecosystem fixture</h1><ToolGrid items={[]} t={({message}) => message} /></main></Layout>;
}
