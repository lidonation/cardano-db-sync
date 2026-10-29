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
        self.assertEqual(self.select(self.report(0)), module.GITHUB)

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

    def test_usage_client_pins_binary_and_keeps_token_out_of_environment(self):
        import hashlib
        from types import SimpleNamespace
        binary = b'test executable'
        env = {'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'private-token',
               'BLACKSMITH_API_URL':'https://untrusted.invalid',
               'BLACKSMITH_DASHBOARD_URL':'https://untrusted.invalid'}
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = binary
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            self.assertNotIn('BLACKSMITH_ORG_TOKEN', kwargs['env'])
            self.assertNotIn('BLACKSMITH_API_URL', kwargs['env'])
            self.assertNotIn('BLACKSMITH_DASHBOARD_URL', kwargs['env'])
            if 'login' in args:
                self.assertEqual(kwargs['input'], 'private-token\n')
                return SimpleNamespace(stdout='')
            return SimpleNamespace(stdout=json.dumps(self.report(50)))
        with mock.patch.object(module, 'CLI_SHA256', hashlib.sha256(binary).hexdigest()), \
             mock.patch.object(module.urllib.request, 'urlopen', return_value=response), \
             mock.patch.object(module.subprocess, 'run', side_effect=run):
            result = module.usage_report(env, '2026-10-01T00:00:00Z', '2026-10-29T21:35:00Z')
        self.assertEqual(result, self.report(50))
        self.assertEqual(len(calls), 2)
        self.assertNotIn('private-token', str(calls[0][0]))

    def test_trusted_main_selects_both_runners(self):
        env = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'push',
               'GITHUB_REF':'refs/heads/release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
               'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'private'}
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            env['GITHUB_OUTPUT'] = str(output)
            for minutes, expected in [(4000, module.BLACKSMITH), (4800, module.GITHUB), (0, module.GITHUB)]:
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
