import importlib.util
import os
import subprocess
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/blacksmith-budget.py'
spec = importlib.util.spec_from_file_location('budget', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TrustedBudgetTests(unittest.TestCase):
    def base(self, output):
        return {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync', 'GITHUB_EVENT_NAME':'pull_request_target',
                'PR_BASE_REF':'release/community-site', 'BLACKSMITH_SITE_ENABLED':'true',
                'BLACKSMITH_ORG':'lidonation', 'BLACKSMITH_ORG_TOKEN':'do-not-print',
                'GITHUB_OUTPUT':str(output), 'PR_NUMBER':'17', 'PR_HEAD_SHA':'a'*40, 'PR_BASE_SHA':'b'*40,
                'GITHUB_RUN_ID':'123', 'BLACKSMITH_PR_SIGNING_KEY':'test-key', 'RUNNER_TEMP':str(output.parent)}

    def test_real_signed_decision_verifies_and_never_includes_private_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            private, public = root/'private.pem', root/'public.pem'
            subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(private)], check=True, capture_output=True)
            subprocess.run(['openssl','pkey','-in',str(private),'-pubout','-out',str(public)], check=True, capture_output=True)
            env = self.base(root/'output'); env['BLACKSMITH_PR_SIGNING_KEY'] = private.read_text()
            module.write_decision(env,'2026-10-29T23:00:00Z')
            artifact = root/'blacksmith-budget'
            self.assertEqual({p.name for p in artifact.iterdir()}, {'decision.json','decision.sig'})
            raw, signature = (artifact/'decision.json').read_bytes(), (artifact/'decision.sig').read_bytes()
            self.assertNotIn(private.read_bytes(), raw + signature)
            verify_spec = importlib.util.spec_from_file_location('proof', SCRIPT.with_name('blacksmith-pr-budget.py'))
            proof = importlib.util.module_from_spec(verify_spec); verify_spec.loader.exec_module(proof)
            self.assertTrue(proof.verify_decision(raw,signature,public,17,'a'*40,'b'*40,123,'2026-10-29T23:05:00Z'))

    def test_untrusted_context_never_reads_the_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            for key, value in [('GITHUB_EVENT_NAME','pull_request'), ('GITHUB_EVENT_NAME','push'),
                               ('GITHUB_REPOSITORY','IntersectMBO/cardano-db-sync'),
                               ('PR_BASE_REF','other'), ('BLACKSMITH_SITE_ENABLED','false'),
                               ('BLACKSMITH_ORG_TOKEN','')]:
                env = self.base(output); env[key] = value; output.write_text('')
                with self.subTest(key=key), mock.patch.dict(os.environ, env, clear=True), \
                     mock.patch.object(module.selector, 'usage_report') as usage, \
                     mock.patch('builtins.print', wraps=print) as log:
                    module.main()
                    usage.assert_not_called()
                    self.assertNotIn('do-not-print', str(log.call_args_list))
                self.assertEqual(output.read_text(),'allowed=false\n')

    def test_approved_only_for_verified_under_budget_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            env = self.base(output)
            for result, expected in [('blacksmith-4vcpu-ubuntu-2404','true'),('ubuntu-24.04','false')]:
                output.write_text('')
                with mock.patch.dict(os.environ, env, clear=True), \
                     mock.patch.object(module.selector, 'usage_report', return_value={}), \
                     mock.patch.object(module.selector, 'choose_runner', return_value=result), \
                     mock.patch.object(module, 'write_decision') as sign:
                    module.main()
                    self.assertEqual(sign.call_count, 1 if expected == 'true' else 0)
                self.assertEqual(output.read_text(),f'allowed={expected}\n')
            output.write_text('')
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(module.selector, 'usage_report', side_effect=ValueError('private')), \
                 mock.patch('builtins.print', wraps=print) as log:
                module.main()
                self.assertNotIn('private', str(log.call_args_list))
            self.assertEqual(output.read_text(),'allowed=false\n')

if __name__ == '__main__': unittest.main()
