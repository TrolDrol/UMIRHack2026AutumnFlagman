import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class Notifications(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        (self.root/'scripts').mkdir(); (self.root/'secrets').mkdir(); (self.root/'prometheus').mkdir()
        shutil.copy(ROOT/'scripts/configure-notifications.py',self.root/'scripts')
        (self.root/'prometheus/targets.live.yml').write_text('[]')
        self.env=os.environ.copy()
        self.env.update({'GF_SMTP_ENABLED':'true','GF_SMTP_HOST':'smtp.test.invalid:587','GF_SMTP_USER':'test','GF_SMTP_FROM_ADDRESS':'rims@test.invalid','TELEGRAM_CHAT_ID':'-123456','ALERT_EMAIL_ADDRESSES':'test@test.invalid'})
        (self.root/'secrets/smtp_password').write_text('test-only')
        (self.root/'secrets/telegram_bot_token').write_text('123456:test-only-token')
    def tearDown(self): self.temp.cleanup()
    def render(self,mode,data_mode='mock'):
        return subprocess.run(['python',str(self.root/'scripts/configure-notifications.py'),'--mode',mode,'--data-mode',data_mode,'--environment','demo'],env=self.env,capture_output=True)
    def test_external_dual_receivers_and_resolution(self):
        r=self.render('external'); self.assertEqual(r.returncode,0,r.stderr)
        doc=json.loads((self.root/'runtime/notifications.json').read_text())
        receiver=next(c for c in doc['contactPoints'] if c['name']=='rims-demo')
        self.assertEqual({r['type'] for r in receiver['receivers']},{'telegram','email'})
        self.assertTrue(all(not r['disableResolveMessage'] for r in receiver['receivers']))
        self.assertEqual(receiver['receivers'][0]['settings']['parse_mode'],'None')
        self.assertTrue(any(r.get('object_matchers')==[['datasource_uid','=','rims-prometheus']] and r['receiver']=='rims-disabled' and r['mute_time_intervals'] for r in doc['policies'][0]['routes']))
        self.assertNotIn(b'test-only-token',r.stdout+r.stderr)
        dest=ROOT/'artifacts/external-notifications-fixture.json'; dest.parent.mkdir(exist_ok=True)
        dest.write_text(json.dumps(doc),encoding='utf-8')
    def test_missing_credentials_refused(self):
        (self.root/'secrets/telegram_bot_token').unlink()
        self.assertNotEqual(self.render('external').returncode,0)
        self.assertFalse((self.root/'runtime/notifications.json').exists())
    def test_technical_receiver_separate(self):
        self.env['TECHNICAL_ALERT_EMAIL_ADDRESSES']='technical@test.invalid'
        r=self.render('external'); self.assertEqual(r.returncode,0,r.stderr)
        doc=json.loads((self.root/'runtime/notifications.json').read_text())
        self.assertTrue(all(r['receiver']=='rims-technical' for r in doc['policies'][0]['routes'][:2]))
    def test_local_muted(self):
        self.assertEqual(self.render('local').returncode,0)
        doc=json.loads((self.root/'runtime/notifications.json').read_text())
        self.assertTrue(all(r['mute_time_intervals'] for r in doc['policies'][0]['routes']))
    def test_live_requires_separate_recipients(self):
        path=self.root/'runtime/live-demo/prometheus/live';path.mkdir(parents=True)
        (path/'targets.yml').write_text(json.dumps([{'targets':['backend:8080'],'labels':{'environment':'demo','data_mode':'live'}}]))
        self.assertNotEqual(self.render('external','live').returncode,0)
if __name__=='__main__': unittest.main()
