"""Select a runner for trusted site builds; every uncertainty fails back to GitHub."""
import datetime as dt
import json
import math
import os
import urllib.parse
import urllib.request

GITHUB = 'ubuntu-24.04'
BLACKSMITH = 'blacksmith-4vcpu-ubuntu-2404'
# CLI describes billing_minutes as rate-normalized vCPU-minutes; the 3,000 free
# minutes are 2-vCPU equivalents. 4,800 billing minutes = 2,400 equivalents.
BILLING_THRESHOLD = 4800
API_ORIGIN = 'https://backend.blacksmith.sh'
MAX_RESPONSE_BYTES = 1_000_000


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
        if not math.isfinite(minutes) or minutes < 0:
            return GITHUB
        return BLACKSMITH if minutes < BILLING_THRESHOLD else GITHUB
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return GITHUB


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the organization bearer token to another origin."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_get(path, token):
    # Fixed host and path; reject all redirects, including same-host redirects.
    if not path.startswith('/api/cli/') or not token:
        raise ValueError('invalid usage request')
    request = urllib.request.Request(API_ORIGIN + path, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'User-Agent': 'blacksmith-ci/1.0',
    })
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(request, timeout=20) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError('usage response too large')
    result = json.loads(body)
    if not isinstance(result, dict):
        raise ValueError('invalid usage response')
    return result


def usage_report(env, start, end):
    # The CLI's JSON serializer turns absent fields into zeros. Read the raw
    # response so a genuine monthly reset is distinguishable from missing data.
    # This API is not documented; strict schema checks and failure fallback are
    # mandatory if the vendor changes it.
    token = env['BLACKSMITH_ORG_TOKEN']
    who = api_get('/api/cli/whoami', token)
    ident = who.get('installation_model_id')
    if (not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0
            or not isinstance(who.get('org'), str)
            or who['org'].casefold() != env['BLACKSMITH_ORG'].casefold()):
        raise ValueError('invalid organization identity')
    query = urllib.parse.urlencode({'start_time': start, 'end_time': end,
                                    'breakdown_by': 'runner_type,repo',
                                    'limit': 50, 'sort_by': 'cost'})
    report = api_get(f'/api/cli/installations/{ident}/usage/actions?{query}', token)
    if not isinstance(report.get('installation'), dict) or report['installation'].get('installation_model_id') != ident:
        raise ValueError('inconsistent installation')
    return report


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
