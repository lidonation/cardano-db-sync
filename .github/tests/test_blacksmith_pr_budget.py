import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/blacksmith-pr-budget.py'
spec = importlib.util.spec_from_file_location('pr_budget', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PrBudgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.private = Path(cls.tmp.name) / 'private.pem'
        cls.public = Path(cls.tmp.name) / 'public.pem'
        subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(cls.private)], check=True, capture_output=True)
        subprocess.run(['openssl','pkey','-in',str(cls.private),'-pubout','-out',str(cls.public)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def setUp(self):
        self.sha = 'a' * 40
        self.base = 'b' * 40
        self.payload = {'repository':'lidonation/cardano-db-sync','pr':17,'head':self.sha,'base':self.base,
                        'run_id':123,'issued_at':'2026-10-29T23:00:00Z','allowed':True}
        self.raw = json.dumps(self.payload,sort_keys=True,separators=(',',':')).encode()
        message = Path(self.tmp.name) / 'message'
        signature = Path(self.tmp.name) / 'signature'
        message.write_bytes(self.raw)
        subprocess.run(['openssl','pkeyutl','-sign','-rawin','-inkey',str(self.private),'-in',str(message),'-out',str(signature)], check=True, capture_output=True)
        self.signature = signature.read_bytes()

    def approved(self, raw=None, signature=None, pr=17, head=None, base=None, run_id=123, now='2026-10-29T23:05:00Z'):
        return module.verify_decision(self.raw if raw is None else raw, self.signature if signature is None else signature,
                                      self.public, pr, self.sha if head is None else head,
                                      self.base if base is None else base, run_id, now)

    def test_signed_exact_decision_is_accepted(self):
        self.assertTrue(self.approved())

    def test_replay_wrong_pr_commit_base_run_or_time_is_rejected(self):
        for kwargs in [dict(pr=18),dict(head='c'*40),dict(base='d'*40),dict(run_id=124),
                       dict(now='2026-10-29T23:15:01Z'),dict(now='2026-10-29T22:59:59Z')]:
            with self.subTest(kwargs=kwargs): self.assertFalse(self.approved(**kwargs))

    def test_untrusted_or_modified_payload_cannot_fake_approval(self):
        for raw, sig in [(self.raw+b' ',self.signature),(self.raw,b'fake'),(b'{}',self.signature)]:
            with self.subTest(raw=raw): self.assertFalse(self.approved(raw=raw,signature=sig))
        other = dict(self.payload,allowed=False)
        self.assertFalse(self.approved(raw=json.dumps(other).encode()))

    def test_approval_requires_well_formed_inputs_and_immutable_run(self):
        for kwargs in [dict(pr=0),dict(pr=True),dict(head='x'*40),dict(base='a'*39),dict(run_id=True)]:
            self.assertFalse(self.approved(**kwargs))

    def test_lookup_accepts_only_a_signed_fresh_exact_artifact(self):
        env = {'PR_NUMBER':'17', 'PR_HEAD_SHA':self.sha, 'PR_BASE_SHA':self.base, 'GH_TOKEN':'read-only'}
        run = {'id':123, 'path':'.github/workflows/blacksmith-budget.yml', 'event':'pull_request_target',
               'status':'completed', 'conclusion':'success', 'created_at':'2026-10-29T23:00:00Z',
               'head_branch':'any-reported-source-branch'}
        artifact = {'id':33,'name':f'blacksmith-budget-pr-17-{self.sha}','expired':False}
        def get(path, token):
            if '/runs?' in path: return {'workflow_runs':[run]}
            return {'artifacts':[artifact]}
        with mock.patch.object(module, 'github_get', side_effect=get), \
             mock.patch.object(module, 'artifact_get', return_value=(self.raw,self.signature)), \
             mock.patch.object(module, 'PUBLIC_KEY', self.public):
            self.assertTrue(module.find_approval(env,'2026-10-29T23:05:00Z'))
            run['id']=124
            self.assertFalse(module.find_approval(env,'2026-10-29T23:05:00Z'))

    def test_stale_runs_are_skipped_before_listing_artifacts(self):
        env = {'PR_NUMBER':'17', 'PR_HEAD_SHA':self.sha, 'PR_BASE_SHA':self.base, 'GH_TOKEN':'read-only'}
        run = {'id':123,'path':'.github/workflows/blacksmith-budget.yml','event':'pull_request_target',
               'status':'completed','conclusion':'success','created_at':'2026-10-29T22:00:00Z'}
        with mock.patch.object(module,'github_get',return_value={'workflow_runs':[run]}) as get:
            self.assertFalse(module.find_approval(env,'2026-10-29T23:05:00Z'))
            self.assertEqual(get.call_count,1)

    def test_valid_archive_round_trip(self):
        import io, zipfile
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            z.writestr('decision.json', self.raw)
            z.writestr('decision.sig', self.signature)
        self.assertEqual(module.read_archive(buf.getvalue()),(self.raw,self.signature))

    def test_pr_consumer_fails_closed_without_proof_and_never_needs_vendor_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'out'
            env = {'GITHUB_REPOSITORY':'lidonation/cardano-db-sync','GITHUB_EVENT_NAME':'pull_request',
                   'PR_BASE_REF':'release/community-site','BLACKSMITH_SITE_ENABLED':'true',
                   'PR_NUMBER':'17','PR_HEAD_SHA':self.sha,'PR_BASE_SHA':self.base,
                   'GH_TOKEN':'read-only','GITHUB_OUTPUT':str(output)}
            for proof, expected in [(True,module.BLACKSMITH),(False,module.GITHUB)]:
                output.write_text('')
                with mock.patch.dict(os.environ,env,clear=True), \
                     mock.patch.object(module,'find_approval',return_value=proof), \
                     mock.patch.object(module.time,'monotonic',side_effect=[0,0,61]), \
                     mock.patch.object(module.time,'sleep'):
                    module.main()
                self.assertEqual(output.read_text(),f'runner={expected}\n')

    def test_non_pr_never_queries_github(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'out'
            env={'GITHUB_REPOSITORY':'lidonation/cardano-db-sync','GITHUB_EVENT_NAME':'push',
                 'PR_BASE_REF':'release/community-site','BLACKSMITH_SITE_ENABLED':'true',
                 'GITHUB_OUTPUT':str(output)}
            with mock.patch.dict(os.environ,env,clear=True), mock.patch.object(module,'find_approval') as query:
                module.main(); query.assert_not_called()
            self.assertEqual(output.read_text(),'runner=ubuntu-24.04\n')

    def test_download_does_not_forward_github_token_to_signed_blob(self):
        import io, zipfile, urllib.error
        from email.message import Message
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            z.writestr('decision.json', self.raw)
            z.writestr('decision.sig', self.signature)
        headers=Message(); headers['Location']='https://productionresultssa2.blob.core.windows.net/test?sig=short'
        redirect=urllib.error.HTTPError('https://api.github.com/test',302,'found',headers,None)
        response=mock.MagicMock(); response.__enter__.return_value.read.return_value=buf.getvalue()
        opener=mock.MagicMock(); opener.open.side_effect=[redirect,response]
        with mock.patch.object(module.urllib.request,'build_opener',return_value=opener):
            self.assertEqual(module.artifact_get(33,'secret-github-token'),(self.raw,self.signature))
        first=opener.open.call_args_list[0].args[0]
        second=opener.open.call_args_list[1].args[0]
        self.assertEqual(first.get_header('Authorization'),'Bearer secret-github-token')
        self.assertIsNone(second.get_header('Authorization'))

    def test_disallows_hostile_artifact_redirect(self):
        import urllib.error
        from email.message import Message
        headers=Message(); headers['Location']='https://attacker.invalid/payload'
        redirect=urllib.error.HTTPError('https://api.github.com/test',302,'found',headers,None)
        opener=mock.MagicMock(); opener.open.side_effect=redirect
        with mock.patch.object(module.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(ValueError): module.artifact_get(33,'secret')
        self.assertEqual(opener.open.call_count,1)

    def test_disallowed_archive_members_are_not_accepted(self):
        import io, zipfile
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            z.writestr('../decision.json', self.raw)
            z.writestr('decision.sig', self.signature)
        with self.assertRaises(ValueError): module.read_archive(buf.getvalue())

if __name__ == '__main__': unittest.main()
