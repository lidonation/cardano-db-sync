#!/usr/bin/env node
/**
 * Ops alert — a scheduled job that fails says so where people look (NUM-4, B41).
 *
 * A cron that dies quietly leaves the Numbers section and the survey dashboard stale until
 * someone notices by accident. Every scheduled workflow ends with this step:
 *
 *   failure or cancellation  open one issue per workflow, labelled `ops-alert`, or comment on the
 *                            open one with the new run: repository watchers are notified each time;
 *   success                  close that workflow's open issue, saying which run recovered it;
 *   skipped                  do nothing.
 *
 * It needs only the job's own token (`issues: write`): no secret, no third party.
 *
 * Run by `.github/workflows/docs-ops-alert.yml`. Inputs come from the environment: OPS_RESULT (the
 * watched job's result), OPS_WORKFLOW (defaults to GITHUB_WORKFLOW), and the standard GITHUB_*
 * variables Actions sets.
 */
import process from 'node:process';

export const LABEL = 'ops-alert';

const LABEL_SPEC = {
  name: LABEL,
  color: 'd93f0b',
  description: 'A scheduled docs job failed; closed automatically when it next succeeds',
};

/** The one issue title per watched workflow. */
export const alertTitle = (workflow) => `[ops-alert] ${workflow} failed`;

/** @typedef {'opened' | 'commented' | 'closed' | 'none'} Action */

/**
 * @typedef {object} AlertInput
 * @property {string} result     The watched job's result: success, failure, cancelled or skipped.
 * @property {string} workflow   The workflow's name.
 * @property {string} runUrl     Link to the run.
 * @property {string} repository `owner/name`.
 * @property {string} apiUrl     GitHub REST base URL.
 * @property {string} token      Token with `issues: write`.
 * @property {string} now        ISO timestamp, for the issue text.
 */

/**
 * Open, update or close the workflow's alert issue for one run.
 *
 * @param {AlertInput} input
 * @param {typeof fetch} [http]
 * @returns {Promise<Action>}
 */
export async function report(input, http = globalThis.fetch) {
  const failed = input.result === 'failure' || input.result === 'cancelled';
  if (!failed && input.result !== 'success') {
    return 'none';
  }

  const call = async (method, route, body) => {
    const response = await http(`${input.apiUrl}/repos/${input.repository}${route}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? {'content-type': 'application/json'} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  };
  const ok = async (response, what) => {
    if (!response.ok) {
      throw new Error(`${what}: HTTP ${response.status} ${await response.text()}`);
    }
    return response;
  };

  const title = alertTitle(input.workflow);
  const open = await ok(
    await call('GET', `/issues?labels=${LABEL}&state=open&per_page=100`),
    'listing open alerts',
  );
  const existing = (await open.json()).find((issue) => issue.title === title);

  if (failed) {
    const line = `The ${input.workflow} run ${input.runUrl} ended **${input.result}** at ${input.now}.`;
    if (existing) {
      await ok(
        await call('POST', `/issues/${existing.number}/comments`, {body: `Still failing. ${line}`}),
        'commenting on the alert',
      );
      return 'commented';
    }
    const label = await call('POST', '/labels', LABEL_SPEC);
    if (!label.ok && label.status !== 422) {
      await ok(label, 'creating the label');
    }
    await ok(
      await call('POST', '/issues', {
        title,
        labels: [LABEL],
        body: [
          line,
          '',
          'A scheduled job that keeps failing leaves the chain and survey data on the site stale.',
          'Open the run, fix the cause, and re-run it. The next successful run closes this issue.',
          'See docs/RUNBOOK.md, "Scheduled-job alerts".',
        ].join('\n'),
      }),
      'opening the alert',
    );
    return 'opened';
  }

  if (!existing) {
    return 'none';
  }
  await ok(
    await call('POST', `/issues/${existing.number}/comments`, {
      body: `Recovered: ${input.runUrl} succeeded at ${input.now}. Closing.`,
    }),
    'commenting on the recovery',
  );
  await ok(
    await call('PATCH', `/issues/${existing.number}`, {state: 'closed', state_reason: 'completed'}),
    'closing the alert',
  );
  return 'closed';
}

/** @typedef {import('./lib/build-output.mjs').Reporter} Reporter */

/**
 * @param {{env?: NodeJS.ProcessEnv, out?: Reporter, http?: typeof fetch, now?: string}} [options]
 * @returns {Promise<number>} 0 on success, 1 when the alert could not be raised, 2 on bad input.
 */
export async function main({
  env = process.env,
  out = /** @type {Reporter} */ (console),
  http = globalThis.fetch,
  now = new Date().toISOString(),
} = {}) {
  const missing = ['OPS_RESULT', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'GITHUB_RUN_ID'].filter(
    (name) => !env[name],
  );
  const workflow = env.OPS_WORKFLOW || env.GITHUB_WORKFLOW;
  if (!workflow) {
    missing.push('OPS_WORKFLOW');
  }
  if (missing.length > 0) {
    out.error(`ops-alert - missing ${missing.join(', ')}`);
    return 2;
  }
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  try {
    const action = await report(
      {
        result: /** @type {string} */ (env.OPS_RESULT),
        workflow: /** @type {string} */ (workflow),
        runUrl: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
        repository: /** @type {string} */ (env.GITHUB_REPOSITORY),
        apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
        token: /** @type {string} */ (env.GITHUB_TOKEN),
        now,
      },
      http,
    );
    out.log(`ops-alert - ${workflow}: ${env.OPS_RESULT} -> ${action}`);
    return 0;
  } catch (error) {
    out.error(
      `ops-alert - could not raise the alert: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main();
}
