"""Verify a signed, short-lived PR budget decision without the vendor token."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

GITHUB = 'ubuntu-24.04'
BLACKSMITH = 'blacksmith-4vcpu-ubuntu-2404'
OWNER_REPO = 'lidonation/cardano-db-sync'
BASE_BRANCH = 'release/community-site'
WORKFLOW_PATH = '.github/workflows/blacksmith-budget.yml'
PUBLIC_KEY = Path(__file__).with_name('blacksmith-pr-public.pem')
MAX_AGE_SECONDS = 900
MAX_API_BYTES = 2_000_000
MAX_ARCHIVE_BYTES = 128_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('timestamp lacks timezone')
    return parsed


def valid_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value) is not None


def verify_decision(raw, signature, key, pr, head, base, run_id, now):
    try:
        if (not valid_id(pr) or not valid_id(run_id) or not valid_sha(head) or not valid_sha(base)
                or not isinstance(raw, bytes) or len(raw) > 4096
                or not isinstance(signature, bytes) or len(signature) != 64):
            return False
        payload = json.loads(raw)
        if (not isinstance(payload, dict) or set(payload) != {'repository','pr','head','base','run_id','issued_at','allowed'}
                or payload['repository'] != OWNER_REPO or payload['pr'] != pr
                or not valid_id(payload['pr']) or payload['head'] != head or payload['base'] != base
                or payload['run_id'] != run_id or not valid_id(payload['run_id']) or payload['allowed'] is not True):
            return False
        age = (timestamp(now) - timestamp(payload['issued_at'])).total_seconds()
        if age < 0 or age > MAX_AGE_SECONDS:
            return False
        with tempfile.TemporaryDirectory(prefix='bs-proof-') as tmp:
            message, sig = Path(tmp) / 'message', Path(tmp) / 'signature'
            message.write_bytes(raw); sig.write_bytes(signature)
            result = subprocess.run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', str(key),
                                     '-rawin', '-in', str(message), '-sigfile', str(sig)],
                                    capture_output=True, timeout=5, check=False)
        return result.returncode == 0
    except (ValueError, TypeError, KeyError, OSError, AttributeError, OverflowError, subprocess.SubprocessError):
        return False


def read_archive(data):
    if not isinstance(data, bytes) or len(data) > MAX_ARCHIVE_BYTES:
        raise ValueError('invalid budget archive')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) != 2 or {i.filename for i in infos} != {'decision.json','decision.sig'}:
            raise ValueError('unexpected budget archive members')
        if any(i.file_size > 4096 or i.is_dir() for i in infos):
            raise ValueError('oversized budget archive member')
        return archive.read('decision.json'), archive.read('decision.sig')


def github_get(path, token):
    if not path.startswith('/repos/' + OWNER_REPO + '/actions/') or not token:
        raise ValueError('invalid GitHub request')
    request = urllib.request.Request('https://api.github.com' + path, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'User-Agent': 'dbsync-ci-pr-budget/1.0', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=5) as response:
        data = response.read(MAX_API_BYTES + 1)
    if len(data) > MAX_API_BYTES:
        raise ValueError('GitHub response too large')
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError('invalid GitHub response')
    return result


def artifact_get(ident, token):
    if not valid_id(ident) or not token:
        raise ValueError('invalid artifact id')
    path = f'/repos/{OWNER_REPO}/actions/artifacts/{ident}/zip'
    request = urllib.request.Request('https://api.github.com' + path, headers={
        'Authorization':'Bearer ' + token, 'Accept':'application/vnd.github+json',
        'User-Agent':'dbsync-ci-pr-budget/1.0', 'X-GitHub-Api-Version':'2022-11-28'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=5) as response:
            data = response.read(MAX_ARCHIVE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code not in (301,302,303,307,308):
            raise
        location = exc.headers.get('Location','')
        parts = urllib.parse.urlsplit(location)
        host = (parts.hostname or '').lower()
        suffixes = ('.blob.core.windows.net', '.actions.githubusercontent.com', '.githubusercontent.com', '.amazonaws.com')
        if (parts.scheme != 'https' or parts.username or parts.password or parts.port not in (None,443)
                or not any(host.endswith(suffix) for suffix in suffixes)):
            raise ValueError('untrusted artifact redirect') from exc
        # The signed URL is fetched without forwarding GitHub's bearer token.
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(location, headers={
                'User-Agent':'dbsync-ci-pr-budget/1.0'}), timeout=5) as response:
            data = response.read(MAX_ARCHIVE_BYTES + 1)
    return read_archive(data)


def find_approval(env, now):
    pr = int(env['PR_NUMBER'])
    head, base = env['PR_HEAD_SHA'], env['PR_BASE_SHA']
    if not valid_id(pr) or not valid_sha(head) or not valid_sha(base):
        return False
    query = urllib.parse.urlencode({'event':'pull_request_target', 'status':'completed', 'per_page':30})
    prefix = f'/repos/{OWNER_REPO}/actions/'
    runs = github_get(prefix + 'runs?' + query, env['GH_TOKEN']).get('workflow_runs')
    if not isinstance(runs, list):
        return False
    candidates = 0
    for run in runs:
        if (not isinstance(run, dict) or run.get('path') != WORKFLOW_PATH
                or run.get('event') != 'pull_request_target' or run.get('status') != 'completed'
                or run.get('conclusion') != 'success' or not valid_id(run.get('id'))):
            continue
        try:
            age = (timestamp(now) - timestamp(run['created_at'])).total_seconds()
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
            continue
        if age < 0 or age > MAX_AGE_SECONDS:
            continue
        candidates += 1
        if candidates > 5:
            break
        ident = run['id']
        artifacts = github_get(prefix + f'runs/{ident}/artifacts?per_page=100', env['GH_TOKEN']).get('artifacts')
        if not isinstance(artifacts, list):
            continue
        name = f'blacksmith-budget-pr-{pr}-{head}'
        for item in artifacts:
            if (isinstance(item, dict) and item.get('name') == name and item.get('expired') is False
                    and valid_id(item.get('id'))):
                raw, signature = artifact_get(item['id'], env['GH_TOKEN'])
                if verify_decision(raw, signature, PUBLIC_KEY, pr, head, base, ident, now):
                    return True
                break  # artifact names are unique per run
    return False


def main():
    runner = GITHUB
    env = os.environ
    if (env.get('GITHUB_REPOSITORY') == OWNER_REPO and env.get('GITHUB_EVENT_NAME') == 'pull_request'
            and env.get('PR_BASE_REF') == BASE_BRANCH and env.get('BLACKSMITH_SITE_ENABLED') == 'true'):
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')
                if find_approval(env, now):
                    runner = BLACKSMITH
                    break
                time.sleep(10)
        except Exception:
            print('Trusted PR budget unavailable; using GitHub runner.')
    with open(env['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        print(f'runner={runner}', file=output)
    print(f'Selected runner: {runner}')


if __name__ == '__main__':
    main()
