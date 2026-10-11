import {fileURLToPath} from 'node:url';

/**
 * Import a gate script as `node` would run it, so its command-line entry point executes, and
 * return the exit code it set. `script` is relative to this directory (`test/unit`).
 */
export async function runAsScript(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const argv = process.argv;
  const saved = {...process.env};
  const url = new URL(script, import.meta.url);
  process.argv = [argv[0], fileURLToPath(url), ...args];
  Object.assign(process.env, env);
  try {
    await import(/* @vite-ignore */ `${url.href}?cli=${Math.random()}`);
    return process.exitCode;
  } finally {
    process.argv = argv;
    process.env = saved;
    process.exitCode = undefined;
  }
}
