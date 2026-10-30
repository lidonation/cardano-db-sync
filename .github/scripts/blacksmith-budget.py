"""Sign a short-lived PR budget decision in the protected target environment."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location('selector', Path(__file__).with_name('blacksmith-runner.py'))
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)


def write_decision(env, now):
    pr = int(env['PR_NUMBER']); run_id = int(env['GITHUB_RUN_ID'])
    head, base = env['PR_HEAD_SHA'], env['PR_BASE_SHA']
    if (pr <= 0 or run_id <= 0 or not re.fullmatch(r'[0-9a-f]{40}', head)
            or not re.fullmatch(r'[0-9a-f]{40}', base) or not env.get('BLACKSMITH_PR_SIGNING_KEY')):
        raise ValueError('invalid signing context')
    payload = {'repository':'lidonation/cardano-db-sync', 'pr':pr, 'head':head, 'base':base,
               'run_id':run_id, 'issued_at':now, 'allowed':True}
    directory = Path(env['RUNNER_TEMP']) / 'blacksmith-budget'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    message, signature = directory / 'decision.json', directory / 'decision.sig'
    message.write_bytes(json.dumps(payload,sort_keys=True,separators=(',',':')).encode())
    with tempfile.TemporaryDirectory(prefix='bs-sign-') as tmp:
        key = Path(tmp) / 'key.pem'
        fd = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(env['BLACKSMITH_PR_SIGNING_KEY'])
        subprocess.run(['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(key),
                        '-in', str(message), '-out', str(signature)],
                       capture_output=True, check=True, timeout=5)
    if len(signature.read_bytes()) != 64:
        raise ValueError('invalid signature')


def main():
    env = os.environ
    allowed = False
    if (env.get('GITHUB_REPOSITORY') == 'lidonation/cardano-db-sync'
            and env.get('GITHUB_EVENT_NAME') == 'pull_request_target'
            and env.get('PR_BASE_REF') == 'release/community-site'
            and env.get('BLACKSMITH_SITE_ENABLED') == 'true'
            and env.get('BLACKSMITH_ORG') and env.get('BLACKSMITH_ORG_TOKEN')):
        try:
            now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
            start = now.replace(day=1, hour=0, minute=0, second=0).isoformat().replace('+00:00','Z')
            end = now.isoformat().replace('+00:00','Z')
            report = selector.usage_report(env, start, end)
            if selector.choose_runner(report, env['BLACKSMITH_ORG'], start, end) == selector.BLACKSMITH:
                write_decision(env, end)
                allowed = True
        except Exception:
            print('PR budget or signature unavailable; using GitHub runners.')
    with open(env['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        print(f'allowed={str(allowed).lower()}', file=output)
    print('PR budget approved:', allowed)


if __name__ == '__main__':
    main()
