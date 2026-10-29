import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/blacksmith-runner.py'
spec = importlib.util.spec_from_file_location('blacksmith_runner', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BlacksmithRunnerTests(unittest.TestCase):
    def report(self, value):
        return {'window': {'start': '2026-10-01T00:00:00Z', 'end': '2026-10-29T21:35:00Z'},
                'installation': {'installation_model_id': 42, 'installation_name': 'lidonation'},
                'summary': {'billing_minutes': value}}

    def select(self, report):
        return module.choose_runner(report, 'lidonation', '2026-10-01T00:00:00Z', '2026-10-29T21:35:00Z')

    def test_normalized_billing_minutes_and_threshold(self):
        self.assertEqual(self.select(self.report(4799)), module.BLACKSMITH)
        self.assertEqual(self.select(self.report(4800)), module.GITHUB)
        self.assertEqual(self.select(self.report(6000)), module.GITHUB)
        self.assertEqual(self.select(self.report(0)), module.BLACKSMITH)

    def test_bad_or_wrong_usage_falls_back(self):
        for obj in [None, {}, {'summary': {}}, self.report(-1), self.report(float('nan')),
                    self.report(True), self.report('2'), self.report(float('inf'))]:
            with self.subTest(obj=obj):
                self.assertEqual(self.select(obj), module.GITHUB)
        for field, value in [('window', {}), ('installation', {}),
                             ('installation', {'installation_model_id': 42, 'installation_name': 'other'})]:
            obj = self.report(2); obj[field] = value
            self.assertEqual(self.select(obj), module.GITHUB)

    def test_safe_event_policy(self):
        good = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'push',
                'GITHUB_REF':'refs/heads/release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
                'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'abc'}
        self.assertTrue(module.enabled(good))
        for key, value in [('GITHUB_REPOSITORY','IntersectMBO/cardano-db-sync'), ('GITHUB_EVENT_NAME','pull_request'),
                           ('GITHUB_REF','refs/heads/other'), ('BLACKSMITH_SITE_ENABLED','false'),
                           ('BLACKSMITH_ORG',''), ('BLACKSMITH_ORG_TOKEN','')]:
            env = dict(good); env[key] = value
            self.assertFalse(module.enabled(env))

    def test_raw_usage_fetch_validates_whoami(self):
        env = {'BLACKSMITH_ORG': 'lidonation', 'BLACKSMITH_ORG_TOKEN': 'private-token'}
        responses = [{'org': 'lidonation', 'installation_model_id': 42}, self.report(0)]
        with mock.patch.object(module, 'api_get', side_effect=responses) as get:
            result = module.usage_report(env, '2026-10-01T00:00:00Z', '2026-10-29T21:35:00Z')
        self.assertEqual(result, self.report(0))
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args_list[0].args[0], '/api/cli/whoami')
        self.assertTrue(get.call_args_list[1].args[0].startswith('/api/cli/installations/42/usage/actions?'))

    def test_bad_identity_never_requests_usage(self):
        env = {'BLACKSMITH_ORG': 'lidonation', 'BLACKSMITH_ORG_TOKEN': 'private-token'}
        for identity in [{}, {'org': 'other', 'installation_model_id': 42},
                         {'org': 'lidonation', 'installation_model_id': True},
                         {'org': 'lidonation', 'installation_model_id': 0}]:
            with self.subTest(identity=identity), mock.patch.object(module, 'api_get', return_value=identity) as get:
                with self.assertRaises(ValueError):
                    module.usage_report(env, 'start', 'end')
                self.assertEqual(get.call_count, 1)

    def test_reject_redirects_to_prevent_token_leak(self):
        handler = module.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, 'redirect', {}, 'https://other.invalid/'))

    def test_absent_billing_field_is_not_genuine_zero(self):
        obj = self.report(0)
        del obj['summary']['billing_minutes']
        self.assertEqual(self.select(obj), module.GITHUB)

    def test_ineligible_main_never_fetches_usage_or_exposes_details(self):
        good = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'push',
                'GITHUB_REF':'refs/heads/release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
                'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'private-token'}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            for key, value in [('GITHUB_EVENT_NAME', 'pull_request'),
                               ('GITHUB_EVENT_NAME', 'pull_request_target'),
                               ('GITHUB_EVENT_NAME', 'workflow_dispatch'),
                               ('GITHUB_EVENT_NAME', 'schedule'),
                               ('GITHUB_REPOSITORY', 'IntersectMBO/cardano-db-sync'),
                               ('BLACKSMITH_SITE_ENABLED', 'false'),
                               ('BLACKSMITH_ORG_TOKEN', '')]:
                output.write_text('')
                env = dict(good, GITHUB_OUTPUT=str(output))
                env[key] = value
                with self.subTest(key=key, value=value), \
                     mock.patch.dict(os.environ, env, clear=True), \
                     mock.patch.object(module, 'usage_report') as usage, \
                     mock.patch('builtins.print', wraps=print) as log:
                    module.main()
                    usage.assert_not_called()
                    self.assertNotIn('private-token', str(log.call_args_list))
                self.assertEqual(output.read_text(), 'runner=ubuntu-24.04\n')

    def test_trusted_main_selects_both_runners(self):
        env = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'push',
               'GITHUB_REF':'refs/heads/release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
               'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'private'}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            env['GITHUB_OUTPUT'] = str(output)
            for minutes, expected in [(4000, module.BLACKSMITH), (4800, module.GITHUB), (0, module.BLACKSMITH)]:
                output.write_text('')
                def report(_, start, end):
                    data = self.report(minutes)
                    data['window'] = {'start': start, 'end': end}
                    return data
                with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(module, 'usage_report', side_effect=report):
                    module.main()
                self.assertEqual(output.read_text(), f'runner={expected}\n')

    def test_query_error_and_bad_data_fail_safe(self):
        good = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'push',
                'GITHUB_REF':'refs/heads/release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
                'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'sensitive'}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            env = dict(good, GITHUB_OUTPUT=str(output))
            for result in [ValueError('private details'), {}, {'summary': {'billing_minutes': 0}}]:
                output.write_text('')
                with mock.patch.dict(os.environ, env, clear=True):
                    if isinstance(result, Exception):
                        patch = mock.patch.object(module, 'usage_report', side_effect=result)
                    else:
                        patch = mock.patch.object(module, 'usage_report', return_value=result)
                    with patch:
                        module.main()
                self.assertEqual(output.read_text(), 'runner=ubuntu-24.04\n')

    def test_unconfigured_cli_outputs_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            env = dict(os.environ, GITHUB_OUTPUT=str(output), BLACKSMITH_SITE_ENABLED='false')
            subprocess.run(['python3', str(SCRIPT)], env=env, check=True)
            self.assertEqual(output.read_text(), 'runner=ubuntu-24.04\n')

if __name__ == '__main__':
    unittest.main()
