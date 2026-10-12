import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import {describe, expect, it} from 'vitest';

import aggregateJson from '../../src/survey-results/aggregate.json';
import fixtureJson from '../../src/survey-results/__fixtures__/sample-aggregate.json';
import DashboardView, {widthBucket} from '../../src/survey-results/Dashboard';
import {DASHBOARD_IDS} from '../../src/survey-results/ids';
import manifestJson from '../../src/survey-results/manifest.json';
import {resolveAggregate} from '../../src/survey-results/resolve';
import type {Aggregate, SurveyManifest} from '../../src/survey-results/types';

const manifest = manifestJson as SurveyManifest;
const aggregate = aggregateJson as Aggregate;
const fixture = fixtureJson as Aggregate;

/** The page wires the locale hook; unit tests render with the English fallback. */
const identity = ({message}: {message: string}) => message;

const markupOf = (source: Aggregate) =>
  renderToStaticMarkup(
    React.createElement(DashboardView, {resolved: resolveAggregate(manifest, source), t: identity}),
  );

describe('survey results dashboard markup (B44-f slice B)', () => {
  const golden = () => markupOf(fixture);

  it('renders one h1 carrying the results title', () => {
    const markup = golden();
    expect(markup).toContain('id="results-title"');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('Survey results');
  });

  it('renders every resolved label and exact count', () => {
    const markup = golden();
    for (const label of [
      'How do you run db-sync?',
      'How do you run db-sync today?',
      'Docker',
      'From source',
      'Prebuilt binary',
      'Nix',
    ]) {
      expect(markup, label).toContain(label);
    }
    expect(markup).toContain('>17<');
    expect(markup).toContain('>7<');
    expect(markup).toContain('>4<');
    expect(markup).toContain('>3<');
  });

  it('states the response-time basis and the interim-forever standing', () => {
    const markup = golden();
    expect(markup).toContain('response-time');
    expect(markup).toContain('2000');
    expect(markup).toContain('interim');
  });

  it('summarises each question from its data', () => {
    const markup = golden();
    expect(markup).toContain('7 responses counted across 1 option.');
    expect(markup).toContain('21 responses counted across 2 options.');
  });

  it('labels history derived, never a CIP-179 tally', () => {
    const markup = golden();
    expect(markup).toContain('derived, never a CIP-179 tally');
    expect(markup).toContain('Epoch 540');
    expect(markup).toContain('Epoch 541');
  });

  it('marks replaces merges as an editorial view', () => {
    expect(golden()).toContain('editorial');
  });

  it('reports superseded options separately, never merged', () => {
    const markup = golden();
    expect(markup).toContain('Superseded by question 1, option 1');
  });

  it('shows reviewed free text and never unreviewed text', () => {
    const markup = golden();
    expect(markup).toContain('Please document the snapshot restore flow.');
    expect(markup).not.toContain('This response has not passed review.');
  });

  it('renders the named pre-tally empty state before any tally runs', () => {
    const markup = markupOf(aggregate);
    expect(markup).toContain('Pre-tally');
    expect(markup).not.toContain('<table');
  });

  it('uses no inline style attribute, which the CSP would refuse (SEC-3)', () => {
    expect(golden()).not.toContain('style=');
    expect(markupOf(aggregate)).not.toContain('style=');
  });

  it('buckets each option share into 5% width steps', () => {
    expect(widthBucket(0)).toBe(0);
    expect(widthBucket(-1)).toBe(0);
    expect(widthBucket(1)).toBe(100);
    expect(widthBucket(7 / 7)).toBe(100);
    expect(widthBucket(17 / 21)).toBe(80);
    expect(widthBucket(4 / 21)).toBe(20);
    expect(widthBucket(2)).toBe(100);
  });
});

describe('dashboard string ids (A11Y-18)', () => {
  it('lists exactly the results.* ids the dashboard renders', () => {
    const root = path.resolve(import.meta.dirname, '../../src');
    const dashboard = readdirSync(path.join(root, 'survey-results'))
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => path.join(root, 'survey-results', file));
    const files = [...dashboard, path.join(root, 'pages', 'survey', 'results.tsx')];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const used = new Set([...source.matchAll(/id: '(results\.[^']+)'/g)].map((match) => match[1]));
    expect([...DASHBOARD_IDS].sort()).toEqual([...used].sort());
  });
});
