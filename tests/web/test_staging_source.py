"""Execute the trusted workflow's actual source gates against real Git history."""
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


def step_script(name):
    text=(Path(__file__).parents[2]/'.github/workflows/mobile-web-preview.yml').read_text()
    block=text.split('    - name: '+name+'\n',1)[1].split('\n    - ',1)[0]
    lines=block.split('      run: |\n',1)[1].splitlines()
    return textwrap.dedent('\n'.join(line for line in lines if line.startswith('        ')))


class StagingSourceTests(unittest.TestCase):
    def run_gate(self,name,directory,sha,run_id=''):
        env={**os.environ,'RUNTIME_REF':sha,'VALIDATION_RUN_ID':run_id}
        return subprocess.run(['bash','-euo','pipefail','-c',step_script(name)],cwd=directory,env=env,capture_output=True,text=True)

    def test_explicit_sha_and_optional_artifact_id_are_not_shell_code(self):
        with tempfile.TemporaryDirectory() as directory:
            for sha,run_id,accepted in [('a'*40,'',True),('b'*40,'123',True),('main','',False),
                                        ('$(false)','',False),('c'*40,'latest',False),('d'*40,'0',False)]:
                with self.subTest(sha=sha,run_id=run_id):
                    p=self.run_gate('Require an exact source for staging',directory,sha,run_id)
                    self.assertEqual(p.returncode==0,accepted,p.stderr+p.stdout)

    def test_only_matching_integrated_commits_can_reach_the_publish_job(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);origin=root/'origin';repo=root/'repo'
            def git(*args,cwd=repo):
                return subprocess.check_output(['git',*args],cwd=cwd,stderr=subprocess.DEVNULL,text=True).strip()
            git('init','--bare',str(origin),cwd=root)
            git('init',str(repo),cwd=root)
            git('config','user.email','staging-test@example.invalid');git('config','user.name','Staging test')
            (repo/'content').write_text('integrated');git('add','content');git('commit','-m','integrated')
            integrated=git('rev-parse','HEAD')
            git('remote','add','origin',str(origin));git('push','origin','HEAD:refs/heads/mobile-web-audit')
            (repo/'content').write_text('unmerged');git('commit','-am','unmerged')
            candidate=git('rev-parse','HEAD')
            gate='Require integrated source for private publication'
            self.assertNotEqual(self.run_gate(gate,repo,candidate).returncode,0)
            self.assertNotEqual(self.run_gate(gate,repo,integrated).returncode,0,'A different checked-out SHA cannot pass')
            git('checkout','--detach',integrated)
            self.assertEqual(self.run_gate(gate,repo,integrated).returncode,0)
            git('checkout','--detach',candidate);git('push','origin','HEAD:refs/heads/mobile-web-audit')
            self.assertEqual(self.run_gate(gate,repo,candidate).returncode,0,'After integration the exact same candidate is publishable')


if __name__=='__main__':
    unittest.main()
