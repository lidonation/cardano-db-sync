import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  createLocaleProxy,
  freePort,
  generatedFilesDir,
  linePrefixer,
  parseOptions,
  pickServer,
  planLocales,
  waitForServer,
} from '../../scripts/start-all-locales.mjs';

const i18n = (baseUrl = '/') => ({
  defaultLocale: 'en',
  locales: ['ja', 'en', 'es'],
  localeConfigs: {
    en: {baseUrl},
    ja: {baseUrl: `${baseUrl}ja/`},
    es: {baseUrl: `${baseUrl}es/`},
  },
});

describe('parseOptions', () => {
  it('reads host, port and an optional locale subset', () => {
    expect(parseOptions([])).toEqual({host: 'localhost', port: 3000, locales: undefined});
    expect(parseOptions(['--host', '0.0.0.0', '--port', '3003', '--locales', 'ja, es,'])).toEqual({
      host: '0.0.0.0',
      port: 3003,
      locales: ['ja', 'es'],
    });
    expect(parseOptions(['--locales', ' , ']).locales).toBeUndefined();
  });

  it.each(['0', '70000', 'abc', '30.5'])('rejects port %s', (port) => {
    expect(() => parseOptions(['--port', port])).toThrow(/--port must be a TCP port number/);
  });

  it('rejects unknown flags', () => {
    expect(() => parseOptions(['--poll'])).toThrow();
  });
});

describe('planLocales', () => {
  it('runs every configured locale, default first, at its Docusaurus base URL', () => {
    expect(planLocales(i18n(), undefined)).toEqual([
      {locale: 'en', baseUrl: '/'},
      {locale: 'ja', baseUrl: '/ja/'},
      {locale: 'es', baseUrl: '/es/'},
    ]);
    expect(planLocales(i18n('/cardano-db-sync/'), undefined).map((s) => s.baseUrl)).toEqual([
      '/cardano-db-sync/',
      '/cardano-db-sync/ja/',
      '/cardano-db-sync/es/',
    ]);
  });

  it('always keeps the default locale in a subset, since it serves every other path', () => {
    expect(planLocales(i18n(), ['es']).map((s) => s.locale)).toEqual(['en', 'es']);
  });

  it('names unknown locales', () => {
    expect(() => planLocales(i18n(), ['fr', 'ja'])).toThrow(
      'Unknown locale(s): fr. Configured: ja, en, es.',
    );
  });

  it('refuses two locales on one base URL', () => {
    const clash = i18n();
    clash.localeConfigs.es.baseUrl = '/ja/';
    expect(() => planLocales(clash, undefined)).toThrow(/ja and es share the base URL \/ja\//);
  });
});

describe('pickServer', () => {
  const servers = [
    {locale: 'en', baseUrl: '/'},
    {locale: 'ja', baseUrl: '/ja/'},
    {locale: 'pt', baseUrl: '/pt/'},
    {locale: 'pt-BR', baseUrl: '/pt/br/'},
  ];
  const locale = (url: string) => pickServer(url, servers).locale;

  it('sends a locale prefix, its socket and its assets to that locale', () => {
    expect(locale('/ja/')).toBe('ja');
    expect(locale('/ja/docs/intro?x=1')).toBe('ja');
    expect(locale('/ja/ws')).toBe('ja');
    expect(locale('/ja/main.0a1b.hot-update.json')).toBe('ja');
    expect(locale('/ja')).toBe('ja');
    expect(locale('/ja?q=1')).toBe('ja');
  });

  it('sends everything else to the default locale', () => {
    expect(locale('/')).toBe('en');
    expect(locale('/ws')).toBe('en');
    expect(locale('/docs/intro')).toBe('en');
    expect(locale('/japan/')).toBe('en');
    expect(locale('/jab')).toBe('en');
    expect(locale('/docs/ja/')).toBe('en');
  });

  it('prefers the longest matching base URL', () => {
    expect(locale('/pt/br/docs')).toBe('pt-BR');
    expect(locale('/pt/docs')).toBe('pt');
  });

  it('routes under a subpath base URL', () => {
    const sub = [
      {locale: 'en', baseUrl: '/cardano-db-sync/'},
      {locale: 'ja', baseUrl: '/cardano-db-sync/ja/'},
    ];
    expect(pickServer('/cardano-db-sync/ja/docs', sub).locale).toBe('ja');
    expect(pickServer('/cardano-db-sync/docs', sub).locale).toBe('en');
    expect(pickServer('/elsewhere', sub).locale).toBe('en');
  });
});

describe('generatedFilesDir', () => {
  it('gives each locale its own directory under .docusaurus', () => {
    expect(generatedFilesDir('ja')).toBe(path.join('.docusaurus', 'all-locales', 'ja'));
    expect(generatedFilesDir('ja')).not.toBe(generatedFilesDir('en'));
  });
});

describe('linePrefixer', () => {
  it('tags complete lines and holds a partial one until flushed', () => {
    const out: string[] = [];
    const p = linePrefixer('[ja]', (l) => out.push(l));
    p.push('one\r\ntw');
    p.push(Buffer.from('o\nthr'));
    expect(out).toEqual(['[ja] one\n', '[ja] two\n']);
    p.flush();
    p.flush();
    expect(out).toEqual(['[ja] one\n', '[ja] two\n', '[ja] thr\n']);
  });
});

describe('createLocaleProxy', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  function listen(server: http.Server | net.Server, port = 0): Promise<number> {
    const sockets = new Set<net.Socket>();
    server.on('connection', (socket: net.Socket) => sockets.add(socket));
    return new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => {
        closers.push(
          () =>
            new Promise((r) => {
              for (const socket of sockets) socket.destroy();
              server.close(() => r());
            }),
        );
        resolve((server.address() as net.AddressInfo).port);
      });
    });
  }

  /** A fake locale dev server: echoes its name and the path; upgrades echo a socket greeting. */
  async function upstream(name: string) {
    const server = http.createServer((req, res) => {
      res.setHeader('x-locale', name);
      res.end(`${name} ${req.method} ${req.url} host=${req.headers.host}`);
    });
    server.on('upgrade', (req, socket, head) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      );
      socket.write(`${name} socket ${req.url}`);
      const echo = (d: Buffer) => socket.write(`|${name} got ${d}`);
      if (head.length) echo(head);
      socket.on('data', echo);
    });
    return listen(server);
  }

  async function setup() {
    const servers = [
      {locale: 'en', baseUrl: '/', port: await upstream('en')},
      {locale: 'ja', baseUrl: '/ja/', port: await upstream('ja')},
    ];
    const port = await listen(createLocaleProxy(servers));
    return {servers, port};
  }

  it('forwards requests to the locale that owns the path, keeping the Host header', async () => {
    const {port} = await setup();
    const ja = await fetch(`http://127.0.0.1:${port}/ja/docs?x=1`, {method: 'POST', body: 'b'});
    expect(ja.headers.get('x-locale')).toBe('ja');
    expect(await ja.text()).toBe(`ja POST /ja/docs?x=1 host=127.0.0.1:${port}`);
    const en = await fetch(`http://127.0.0.1:${port}/docs/intro`);
    expect(await en.text()).toBe(`en GET /docs/intro host=127.0.0.1:${port}`);
  });

  it('routes WebSocket upgrades (HMR) by path, both ways', async () => {
    const {port} = await setup();
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          'GET /ja/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
        );
        setTimeout(() => socket.write('hello'), 20);
      });
      let data = '';
      socket.on('data', (d) => {
        data += d;
        if (data.includes('got hello')) {
          socket.end();
          resolve(data);
        }
      });
      socket.on('error', reject);
    });
    expect(reply).toContain('101 Switching Protocols');
    expect(reply).toContain('ja socket /ja/ws');
    expect(reply).toContain('|ja got hello');
  });

  it('closes an upgrade whose locale server is down', async () => {
    const dead = await freePort();
    const port = await listen(createLocaleProxy([{locale: 'en', baseUrl: '/', port: dead}]));
    await new Promise<void>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(
          'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
        );
      });
      socket.on('close', () => resolve());
      socket.on('error', () => {});
    });
  });

  it('answers 502 naming the locale while its server is not up', async () => {
    const dead = await freePort();
    const port = await listen(
      createLocaleProxy([
        {locale: 'en', baseUrl: '/', port: await upstream('en')},
        {locale: 'ja', baseUrl: '/ja/', port: dead},
      ]),
    );
    const res = await fetch(`http://127.0.0.1:${port}/ja/`);
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/^The ja dev server is not answering \(ECONNREFUSED\)/);
  });

  it('waits for a server to answer, and gives up once stopped', async () => {
    const port = await upstream('en');
    expect(await waitForServer({locale: 'en', baseUrl: '/', port}, {isDone: () => false})).toBe(
      true,
    );
    const dead = await freePort();
    let polls = 0;
    const gaveUp = await waitForServer(
      {locale: 'ja', baseUrl: '/ja/', port: dead},
      {isDone: () => polls++ > 1, intervalMs: 1},
    );
    expect(gaveUp).toBe(false);
  });
});
