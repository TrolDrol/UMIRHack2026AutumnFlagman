"""Explicit credential/connectivity check; never sends Telegram messages or email."""
import argparse, importlib.util, json, os, smtplib, socket, ssl, subprocess, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--env-file',type=Path,required=True);p.add_argument('--targets',type=Path,required=True);p.add_argument('--environment',default='staging');p.add_argument('--config-root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--connect',action='store_true');p.add_argument('--evidence',type=Path)
    p.add_argument('--container',help='Additionally check Grafana secret access and Telegram through this actual container')
    a=p.parse_args();settings={}
    for line in a.env_file.read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1);settings[key]=value.strip().strip('"').strip("'")
    settings.update(os.environ)
    spec=importlib.util.spec_from_file_location('notifications',Path(__file__).with_name('configure-notifications.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.render(a.config_root,'external','live',a.environment,a.targets,settings)
    report={'utc':datetime.now(timezone.utc).isoformat(),'configuration':'PASS','smtpAuth':'not tested','telegramBot':'not tested','telegramChat':'not tested','delivery':'no messages sent; receipt not verified'}
    if a.connect:
        if settings.get('RIMS_NOTIFICATION_IPV6','false').lower()=='true':
            addresses={row[4][0] for row in socket.getaddrinfo('api.telegram.org',443,socket.AF_INET6,socket.SOCK_STREAM)}
            report['telegramAddress']='PASS configured IPv6 matches current DNS AAAA' if settings['RIMS_TELEGRAM_API_IPV6'] in addresses else 'FAIL refresh RIMS_TELEGRAM_API_IPV6 from current provider DNS'
        report['smtpNetworkScope']='preflight host; TLS/AUTH only'
        if a.container:
            readable=all(subprocess.run(['docker','exec',a.container,'test','-r','/run/secrets/'+name],capture_output=True).returncode==0 for name in ['smtp_password','admin_password','secret_key'])
            report['grafanaSecretAccess']='PASS' if readable else 'FAIL secret file unreadable by Grafana UID'
        host,port=settings['GF_SMTP_HOST'].rsplit(':',1)
        try:
            with smtplib.SMTP(host,int(port),timeout=20) as smtp:
                smtp.ehlo();smtp.starttls(context=ssl.create_default_context());smtp.ehlo()
                smtp.login(settings['GF_SMTP_USER'],(a.config_root/'secrets/smtp_password').read_text(encoding='utf-8-sig').strip())
                smtp.noop()
            report['smtpAuth']='PASS STARTTLS/certificate verification/AUTH; no MAIL or DATA'
        except (OSError,smtplib.SMTPException) as e:report['smtpAuth']='FAIL '+type(e).__name__
        token=(a.config_root/'secrets/live_telegram_bot_token').read_text(encoding='utf-8-sig').strip()
        def telegram(method,data):
            if a.container:
                # Capture output: wget failures can contain the credential-bearing URL.
                url='https://api.telegram.org/bot'+token+'/'+method
                if data:
                    import urllib.parse
                    url+='?'+urllib.parse.urlencode(data)
                result=subprocess.run(['docker','exec',a.container,'wget','-q','-T','20','-O','-',url],capture_output=True,timeout=30)
                if result.returncode:raise OSError('Container request failed')
                return json.loads(result.stdout)
            req=urllib.request.Request('https://api.telegram.org/bot'+token+'/'+method,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=20) as response:return json.load(response)
        for key,method,data in [('telegramBot','getMe',{}),('telegramChat','getChat',{'chat_id':settings['LIVE_TELEGRAM_CHAT_ID']})]:
            try:
                response=telegram(method,data)
                if not response.get('ok'):raise ValueError('Provider refused request')
                report[key]='PASS '+('@'+response['result']['username'] if method=='getMe' else 'target chat accessible')
            except (OSError,ValueError,subprocess.TimeoutExpired) as e:report[key]='FAIL '+type(e).__name__
        report['telegramNetworkScope']='Grafana container' if a.container else 'preflight host'
    if a.evidence:
        a.evidence.parent.mkdir(parents=True,exist_ok=True);a.evidence.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    if any(str(value).startswith('FAIL') for value in report.values()):raise SystemExit(1)
if __name__=='__main__':main()
