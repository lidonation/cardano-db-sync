import {readFileSync} from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {describe, expect, it} from 'vitest';
type Container = {
  name: string;
  volumeMounts: {name: string; mountPath: string}[];
  env: {name: string; valueFrom?: {secretKeyRef: {name: string}}}[];
};
type Deployment = {
  kind: string;
  spec: {replicas: number; strategy: {type: string}; template: {spec: {containers: Container[]}}};
};
const dir = path.resolve(import.meta.dirname, '../../docs/guides');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');

describe('new operating guides (CON-11)', () => {
  it('defines a single-writer preview deployment with shared IPC, persistent state and secret-backed credentials', () => {
    const text = read('kubernetes.md');
    const manifest = /```yaml\n([\s\S]*?)\n```/.exec(text);
    expect(manifest).not.toBeNull();
    const deployment = yaml.load(manifest![1]) as Deployment;
    expect(deployment.kind).toBe('Deployment');
    expect(deployment.spec.replicas).toBe(1);
    expect(deployment.spec.strategy.type).toBe('Recreate');
    const pod = deployment.spec.template.spec;
    const node = pod.containers.find((c: Container) => c.name === 'cardano-node');
    const sync = pod.containers.find((c: Container) => c.name === 'cardano-db-sync');
    expect(node?.volumeMounts).toContainEqual({name: 'node-ipc', mountPath: '/ipc'});
    expect(sync?.volumeMounts).toContainEqual({name: 'node-ipc', mountPath: '/node-ipc'});
    expect(sync?.volumeMounts).toContainEqual({
      name: 'db-sync-data',
      mountPath: '/var/lib/cexplorer',
    });
    expect(
      sync?.env.find((e) => e.name === 'POSTGRES_PASSWORD')?.valueFrom?.secretKeyRef.name,
    ).toBeTruthy();
    expect(text).toMatch(/preview/i);
    expect(text).toMatch(/persistentvolumeclaim/i);
    expect(text).toMatch(/rollback/i);
  });
  it('documents the release parser limitations and credential safety', () => {
    const text = read('ubuntu-systemd.md');
    expect(text).toMatch(/first line/i);
    expect(text).toMatch(/no colons or backslashes/i);
    expect(text).toMatch(/does not unescape/i);
    expect(text).toMatch(/restrict access to logs/i);
    expect(text).toMatch(/rotate/i);
    expect(text).not.toMatch(/escape colons and backslashes/i);
  });
  it('documents a least-privilege systemd service with protected credentials and recovery', () => {
    const text = read('ubuntu-systemd.md');
    expect(text).toMatch(/User=dbsync/);
    expect(text).toMatch(/PGPASSFILE=/);
    expect(text).toMatch(/chmod 600/);
    expect(text).toMatch(/--socket-path/);
    expect(text).toMatch(/socket itself.*write access/i);
    expect(text).toMatch(/after node restarts/i);
    expect(text).toMatch(/--schema-dir/);
    expect(text).toMatch(/journalctl/);
    expect(text).toMatch(/rollback/i);
    expect(text).toMatch(/preview/i);
  });
});
