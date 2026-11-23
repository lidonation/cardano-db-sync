import fs from 'node:fs';
import path from 'node:path';
import {expect, test} from '@playwright/test';
import ts from 'typescript';

import {PROFILES} from '../../config/profiles';
import {BUILT_HOME} from '../../playwright.built.config';
import type * as WalletClient from '../../src/wallet/client';

/**
 * Simulated injection only: this proves our adapter runs under the real built CSP, not SEC-7's
 * real-extension injection mechanism or a valid ledger transaction. Nothing here spends ADA.
 * Serve the actual adapter as same-origin ES modules without adding a deployed test route.
 */
test.beforeEach(async ({page}) => {
  await page.route('**/__wallet-test/*.js', async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname, '.js');
    const source =
      name === 'entry'
        ? `import * as client from './client.js'; window.testWalletClient = client;`
        : fs.readFileSync(path.resolve('src/wallet', `${name}.ts`), 'utf8');
    const body = ts
      .transpileModule(source, {
        compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
      })
      .outputText.replace("from './networkGuard'", "from './networkGuard.js'");
    await route.fulfill({contentType: 'text/javascript', body});
  });
  await page.goto(new URL('survey/results', BUILT_HOME).href);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await page.addScriptTag({
    url: new URL('__wallet-test/entry.js', BUILT_HOME).href,
    type: 'module',
  });
  await page.waitForFunction(() => 'testWalletClient' in window);
});

test('the built CSP actually blocks an inline script', async ({page}) => {
  const result = await page.evaluate(
    () =>
      new Promise<{blocked: string; executed: boolean}>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (event) => {
            resolve({blocked: event.blockedURI, executed: 'walletInlineProbe' in window});
          },
          {once: true},
        );
        const script = document.createElement('script');
        script.textContent = 'window.walletInlineProbe = true';
        document.head.append(script);
        script.remove();
      }),
  );
  expect(result).toEqual({blocked: 'inline', executed: false});
});

const network = PROFILES[process.env.DBS_BUILT_PROFILE === 'prod' ? 'prod' : 'dev'].network;

test('simulated CIP-30 bridge signs a matching-network flow under the built CSP', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/violat|refused/i.test(message.text())) violations.push(message.text());
  });
  const result = await page.evaluate(async (expected) => {
    const {connectWallet, discoverWallets} = (
      window as unknown as {testWalletClient: typeof WalletClient}
    ).testWalletClient;
    const actions: string[] = [];
    const api = {
      getNetworkId: async () => (expected === 'preview' ? 0 : 1),
      getUtxos: async () => ['a0'],
      getChangeAddress: async () => '60aa',
      getRewardAddresses: async () => [],
      signTx: async () => {
        actions.push('sign');
        return 'a100';
      },
      submitTx: async (tx: string) => {
        actions.push(`submit:${tx}`);
        return 'ab'.repeat(32);
      },
    };
    Object.assign(window, {
      cardano: {
        mock: {
          name: 'Mock wallet',
          apiVersion: '0.1.0',
          enable: async () => {
            actions.push('enable');
            return api;
          },
        },
      },
    });
    const candidates = discoverWallets();
    const beforeConnect = [...actions];
    const session = await connectWallet('mock', expected);
    const hash = await session.signAndSubmit({
      build: async (inputs) => {
        actions.push(`build:${inputs.network}`);
        return '84a0';
      },
      assemble: async (unsigned, witnesses) => {
        actions.push(`assemble:${unsigned}:${witnesses}`);
        return '84a1';
      },
    });
    return {candidates, beforeConnect, hash, actions};
  }, network);
  expect(result).toEqual({
    candidates: [{id: 'mock', name: 'Mock wallet'}],
    beforeConnect: [],
    hash: 'ab'.repeat(32),
    actions: ['enable', `build:${network}`, 'sign', 'assemble:84a0:a100', 'submit:84a1'],
  });
  expect(violations).toEqual([]);
});

test('simulated wrong-network wallet is a named hard block, even if switched after connection', async ({
  page,
}) => {
  const results = await page.evaluate(async (expected) => {
    const {connectWallet} = (window as unknown as {testWalletClient: typeof WalletClient})
      .testWalletClient;
    const actions: string[] = [];
    const matching = expected === 'preview' ? 0 : 1;
    let current = 1 - matching;
    const registry = {
      mock: {
        name: 'Mock wallet',
        apiVersion: '1.0.0',
        enable: async () => ({
          getNetworkId: async () => current,
          getUtxos: async () => ['a0'],
          getChangeAddress: async () => '60aa',
          getRewardAddresses: async () => [],
          signTx: async () => {
            actions.push('sign');
            return 'a100';
          },
          submitTx: async () => {
            actions.push('submit');
            return 'ab'.repeat(32);
          },
        }),
      },
    };
    const errorOf = async (action: () => Promise<unknown>) => {
      try {
        await action();
        return null;
      } catch (error) {
        const e = error as Error & {code: string};
        return {code: e.code, message: e.message};
      }
    };
    const connectionError = await errorOf(() => connectWallet('mock', expected, registry));
    current = matching;
    const session = await connectWallet('mock', expected, registry);
    const signingError = await errorOf(() =>
      session.signAndSubmit({
        build: async () => {
          actions.push('build');
          current = 1 - matching;
          return '84a0';
        },
        assemble: async () => {
          actions.push('assemble');
          return '84a1';
        },
      }),
    );
    return {connectionError, signingError, actions};
  }, network);
  for (const error of [results.connectionError, results.signingError]) {
    expect(error?.code).toBe('WALLET_NETWORK_MISMATCH');
    expect(error?.message).toContain(`Switch your wallet to ${network}`);
  }
  expect(results.actions).toEqual(['build']);
});
