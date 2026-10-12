import React from 'react';
import {MAIN_CONTENT_ID} from '../lib/accessibility';
import Layout from '@theme/Layout';
import DashboardView from './Dashboard';
import fixture from './__fixtures__/sample-aggregate.json';
import manifest from './manifest.json';
import {resolveAggregate} from './resolve';
import type {Aggregate, SurveyManifest} from './types';

export default function FixturePage() {
  return (
    <Layout title="Survey fixture">
      <main id={MAIN_CONTENT_ID} tabIndex={-1} lang="en">
        <DashboardView
          resolved={resolveAggregate(manifest as SurveyManifest, fixture as Aggregate)}
          t={({message}) => message}
        />
      </main>
    </Layout>
  );
}
