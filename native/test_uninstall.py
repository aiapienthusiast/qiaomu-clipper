import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('uninstall.py')

class UninstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.home = root / 'home'; self.system = root / 'Library' / 'QiaomuClipper'
        support = self.home / 'Library/Application Support'
        self.ours = [support / 'Google/Chrome/NativeMessagingHosts/ai.qiaomu.clipper.json', support / 'Arc/User Data/NativeMessagingHosts/ai.qiaomu.clipper.json']
        self.foreign = support / 'Google/Chrome/NativeMessagingHosts/com.other.host.json'
        self.notes = self.home / 'Vault/note.md'
        self.base = self.home / '.local/share/qiaomu-clipper'
        for path in self.ours: path.parent.mkdir(parents=True); path.write_text(json.dumps({'name': 'ai.qiaomu.clipper'}))
        self.foreign.write_text(json.dumps({'name': 'com.other.host'}))
        self.notes.parent.mkdir(parents=True); self.notes.write_text('keep me')
        (self.base / 'tools/mlx').mkdir(parents=True); (self.base / 'tools/mlx/lib.bin').write_bytes(b'x' * 2048)
        (self.base / 'config.json').write_text('{}')
        (self.system / 'runtime-arm64').mkdir(parents=True); (self.system / 'runtime-arm64/python3').write_bytes(b'x' * 1024)
        self.env = {**os.environ, 'HOME': str(self.home), 'QIAOMU_INSTALL_ROOT': str(self.system), 'QIAOMU_UNINSTALL_NO_ADMIN': '1', 'HF_HOME': str(root / 'hf')}

    def tearDown(self): self.tmp.cleanup()

    def run_script(self, *args):
        r = subprocess.run([sys.executable, '-I', str(SCRIPT), *args], env=self.env, capture_output=True, text=True)
        return r.returncode, json.loads(r.stdout)

    def test_plan_reads_only_and_counts_what_would_go(self):
        code, plan = self.run_script('--plan')
        self.assertEqual(code, 0)
        self.assertEqual(sorted(plan['registrations']), sorted(map(str, self.ours)))
        self.assertTrue(plan['needsAdmin']); self.assertEqual(plan['user'], str(self.base))
        self.assertTrue(all(p.exists() for p in self.ours) and self.base.exists() and self.system.exists())

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS layout')
    def test_removes_only_our_files_and_never_notes(self):
        code, result = self.run_script()
        self.assertEqual(code, 0); self.assertTrue(result['ok']); self.assertEqual(result['left'], [])
        self.assertFalse(any(p.exists() for p in self.ours)); self.assertFalse(self.base.exists())
        self.assertTrue(self.foreign.exists()); self.assertEqual(self.notes.read_text(), 'keep me')

    def test_running_twice_is_fine(self):
        self.run_script(); code, result = self.run_script()
        self.assertEqual(code, 0); self.assertTrue(result['ok'])

if __name__ == '__main__': unittest.main()
