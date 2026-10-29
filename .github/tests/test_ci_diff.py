import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/classify-ci-diff.py'
spec = importlib.util.spec_from_file_location('classify', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DiffTests(unittest.TestCase):
    def test_classification(self):
        for paths, expected in [
            ([b'docs/src/a.ts'], False),
            ([b'.github/workflows/docs-site.yml'], False),
            ([b'docs/src/a.ts', b'.github/workflows/docs-site.yml'], False),
            ([b'.github/workflows/docs-site.yml', b'cardano-db/a.hs'], True),
            ([b'.github/workflows/docs-site.yml', b'.github/scripts/classify-ci-diff.py'], True),
            ([b'.github/workflows/docs-site.yml.bak'], True),
            ([b'docs/extractor/src/a.hs'], True),
            ([b'docs/a', b'cardano-db/a.hs'], True),
            ([b'.github/workflows/haskell.yml'], True),
            ([], True),
        ]:
            with self.subTest(paths=paths):
                self.assertEqual(module.requires_full_ci(paths), expected)

    def test_real_git_diff_and_rename_outside_docs(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=tmp, stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.name', 'CI test')
            git('config', 'user.email', 'ci@example.invalid')
            (Path(tmp) / 'docs').mkdir()
            (Path(tmp) / 'docs/a').write_text('site')
            git('add', '.')
            git('commit', '-m', 'base')
            base = git('rev-parse', 'HEAD')
            (Path(tmp) / 'docs/a').write_text('changed')
            git('commit', '-am', 'site')
            site = git('rev-parse', 'HEAD')
            workflow = Path(tmp) / '.github/workflows/docs-site.yml'
            workflow.parent.mkdir(parents=True)
            workflow.write_text('site workflow')
            git('add', '.')
            git('commit', '-m', 'site workflow')
            site_workflow = git('rev-parse', 'HEAD')
            git('branch', 'community-base', base)
            git('mv', 'docs/a', 'backend')
            git('commit', '-m', 'move')
            moved = git('rev-parse', 'HEAD')
            out = Path(tmp) / 'out'
            for event, before, head, expected in [
                ('push', base, site, 'false'),
                ('push', '0' * 40, site_workflow, 'false'),
                ('pull_request', base, site_workflow, 'false'),
                ('push', site_workflow, moved, 'true'),
                ('pull_request', base, site, 'false'),
                ('push', site, moved, 'true'),
                ('push', '0' * 40, site, 'false'),
                ('push', '0' * 40, moved, 'true'),
            ]:
                out.write_text('')
                env = dict(os.environ, EVENT_NAME=event, BEFORE=before, BASE_SHA=before,
                           HEAD_SHA=head, NEW_BRANCH_BASE='community-base', GITHUB_OUTPUT=str(out))
                subprocess.run(['python3', str(SCRIPT)], cwd=tmp, env=env, check=True)
                self.assertEqual(out.read_text(), f'run={expected}\n')

    def test_new_branch_missing_or_unrelated_baseline_fails_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=tmp, stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.name', 'CI test')
            git('config', 'user.email', 'ci@example.invalid')
            (Path(tmp) / 'file').write_text('base')
            git('add', '.')
            git('commit', '-m', 'base')
            git('branch', 'base')
            git('checkout', '--orphan', 'unrelated')
            git('commit', '--allow-empty', '-m', 'unrelated')
            head = git('rev-parse', 'HEAD')
            out = Path(tmp) / 'out'
            for baseline in ('base', 'missing', ''):
                out.write_text('')
                env = dict(os.environ, EVENT_NAME='push', BEFORE='0' * 40,
                           HEAD_SHA=head, NEW_BRANCH_BASE=baseline, GITHUB_OUTPUT=str(out))
                subprocess.run(['python3', str(SCRIPT)], cwd=tmp, env=env, check=True)
                self.assertEqual(out.read_text(), 'run=true\n')

    def test_unavailable_history_fails_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'out'
            env = dict(os.environ, EVENT_NAME='push', BEFORE='missing', HEAD_SHA='missing', GITHUB_OUTPUT=str(out))
            subprocess.run(['python3', str(SCRIPT)], cwd=tmp, env=env, check=True)
            self.assertEqual(out.read_text(), 'run=true\n')


if __name__ == '__main__':
    unittest.main()
