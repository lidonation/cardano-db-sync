"""Select a runner for trusted site builds; every uncertainty fails back to GitHub."""
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

GITHUB = 'ubuntu-24.04'
BLACKSMITH = 'blacksmith-4vcpu-ubuntu-2404'
# CLI describes billing_minutes as rate-normalized vCPU-minutes; the 3,000 free
# minutes are 2-vCPU equivalents. 4,800 billing minutes = 2,400 equivalents.
BILLING_THRESHOLD = 4800
CLI_URL = 'https://clireleases.blacksmith.sh/cli/latest/linux/amd64/blacksmith'
CLI_SHA256 = '089a301ea5cc93a7560c7f1106911547fdfd46fc5c0cef7079e2a62a22e971ce'


def enabled(env):
    return (env.get('GITHUB_REPOSITORY') == 'lidonation/cardano-db-sync'
            and env.get('GITHUB_EVENT_NAME') == 'push'
            and env.get('GITHUB_REF') == 'refs/heads/release/community-site'
            and env.get('BLACKSMITH_SITE_ENABLED') == 'true'
            and bool(env.get('BLACKSMITH_ORG')) and bool(env.get('BLACKSMITH_ORG_TOKEN')))


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def choose_runner(data, org, start, end):
    try:
        window = data['window']
        installation = data['installation']
        summary = data['summary']
        if (timestamp(window['start']) != timestamp(start)
                or timestamp(window['end']) != timestamp(end)
                or not isinstance(installation['installation_model_id'], int)
                or isinstance(installation['installation_model_id'], bool)
                or installation['installation_model_id'] <= 0
                or installation['installation_name'].casefold() != org.casefold()):
            return GITHUB
        minutes = summary['billing_minutes']
        if isinstance(minutes, bool) or not isinstance(minutes, (int, float)):
            return GITHUB
        if not math.isfinite(minutes) or minutes <= 0:
            return GITHUB
        return BLACKSMITH if minutes < BILLING_THRESHOLD else GITHUB
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return GITHUB


def usage_report(env, start, end):
    with tempfile.TemporaryDirectory(prefix='blacksmith-usage-') as tmp:
        binary = Path(tmp) / 'blacksmith'
        with urllib.request.urlopen(CLI_URL, timeout=20) as response:
            content = response.read(100_000_001)
        if len(content) > 100_000_000 or hashlib.sha256(content).hexdigest() != CLI_SHA256:
            raise ValueError('unverified CLI')
        binary.write_bytes(content)
        binary.chmod(0o700)
        cli_env = dict(env, HOME=tmp, BLACKSMITH_DISABLE_AUTO_UPDATE='1')
        cli_env.pop('BLACKSMITH_ORG_TOKEN', None)
        # Do not let ambient CLI settings redirect the organization token.
        cli_env.pop('BLACKSMITH_API_URL', None)
        cli_env.pop('BLACKSMITH_DASHBOARD_URL', None)
        subprocess.run([str(binary), 'auth', 'login', '--api-token', '-', '--non-interactive',
                        '--organization', env['BLACKSMITH_ORG']], input=env['BLACKSMITH_ORG_TOKEN'] + '\n',
                       text=True, env=cli_env, capture_output=True, check=True, timeout=30)
        result = subprocess.run([str(binary), 'usage', '--start-time', start, '--end-time', end,
                                 '--format', 'json'], text=True, env=cli_env, capture_output=True,
                                check=True, timeout=30)
        return json.loads(result.stdout)


def main():
    runner = GITHUB
    if enabled(os.environ):
        try:
            now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
            start = now.replace(day=1, hour=0, minute=0, second=0).isoformat().replace('+00:00', 'Z')
            end = now.isoformat().replace('+00:00', 'Z')
            runner = choose_runner(usage_report(os.environ, start, end), os.environ['BLACKSMITH_ORG'], start, end)
        except Exception:
            print('Blacksmith usage unavailable or invalid; using GitHub runner.')
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        print(f'runner={runner}', file=output)
    print(f'Selected runner: {runner}')


if __name__ == '__main__':
    main()
