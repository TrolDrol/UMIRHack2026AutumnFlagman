"""Render provisioning only; no network calls. External preparation remains muted."""
import argparse, ipaddress, json, os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def render(root,mode,data_mode,environment,targets,settings,enable_delivery=False):
    def require(key):
        value=settings.get(key,'').strip()
        if not value or 'example.' in value: raise ValueError('Missing/placeholder setting: '+key)
        return value
    def secret(name):
        p=root/'secrets'/name
        if not p.exists() or not p.read_text().strip(): raise ValueError('Missing secret file: '+name)
        return p.read_text().strip().replace('$','$$')
    if data_mode=='live':
        records=json.loads(targets.read_text())
        if len(records)!=1 or records[0].get('targets')!=['backend:8080'] or records[0].get('labels')!={'environment':environment,'data_mode':'live'}:
            raise ValueError('Expected one active backend:8080 live target in selected environment')
    contacts=[{'orgId':1,'name':'rims-disabled','receivers':[{'uid':'rims-disabled-email','type':'email','disableResolveMessage':False,'settings':{'addresses':'disabled@example.invalid'}}]}]
    mute={'mute_time_intervals':['rims-delivery-disabled']}
    routes=[
        {'receiver':'rims-disabled','object_matchers':[['alertname','=~','DatasourceNoData|DatasourceError']],'group_by':['datasource_uid','alertname'],**mute},
        {'receiver':'rims-disabled','object_matchers':[['datasource_uid','=','rims-prometheus']],'group_by':['datasource_uid','alertname'],**mute},
        {'receiver':'rims-disabled','object_matchers':[['data_mode','=',data_mode]],**mute}]
    technical='not configured; muted'
    if mode=='external':
        if require('GF_SMTP_ENABLED').lower()!='true': raise ValueError('External profile requires GF_SMTP_ENABLED=true')
        if settings.get('GF_SMTP_SKIP_VERIFY','false').lower()!='false': raise ValueError('SMTP TLS verification must remain enabled')
        if settings.get('GF_SMTP_STARTTLS_POLICY','MandatoryStartTLS')!='MandatoryStartTLS': raise ValueError('Require MandatoryStartTLS')
        for key in ['GF_SMTP_HOST','GF_SMTP_USER','GF_SMTP_FROM_ADDRESS']: require(key)
        if settings.get('RIMS_NOTIFICATION_IPV6','false').lower()=='true':
            ipaddress.IPv6Address(require('RIMS_TELEGRAM_API_IPV6'))
        secret('smtp_password')
        prefix='LIVE_' if data_mode=='live' else ''
        chat=require(prefix+'TELEGRAM_CHAT_ID')
        try: int(chat)
        except ValueError: raise ValueError('Telegram chat ID must be an integer')
        addresses=require(prefix+'ALERT_EMAIL_ADDRESSES')
        token=secret('live_telegram_bot_token' if data_mode=='live' else 'telegram_bot_token')
        name='rims-live' if data_mode=='live' else 'rims-demo'
        contacts.append({'orgId':1,'name':name,'receivers':[
            {'uid':name+'-telegram','type':'telegram','disableResolveMessage':False,'settings':{'bottoken':token,'chatid':chat,'parse_mode':'None','message':'{{ template "rims.message" . }}','disable_web_page_preview':True}},
            {'uid':name+'-email','type':'email','disableResolveMessage':False,'settings':{'addresses':addresses,'singleEmail':True,'subject':'[LIVE]' if data_mode=='live' else '[DEMO][MOCK]','message':'{{ template "rims.message" . }}'}}]})
        routes[-1].update(receiver=name,group_by=['environment','data_mode','warehouse_id','alertname'])
        routes[-1]['object_matchers'].append(['environment','=',environment])
        if enable_delivery: routes[-1].pop('mute_time_intervals')
        if settings.get('TECHNICAL_ALERT_EMAIL_ADDRESSES'):
            contacts.append({'orgId':1,'name':'rims-technical','receivers':[{'uid':'rims-technical-email','type':'email','disableResolveMessage':False,'settings':{'addresses':require('TECHNICAL_ALERT_EMAIL_ADDRESSES'),'singleEmail':True,'subject':'[TECHNICAL] RIMS {{ .CommonLabels.alertname }}'}}]})
            for route in routes[:2]:
                route['receiver']='rims-technical'
                if enable_delivery: route.pop('mute_time_intervals')
            technical='configured; '+('enabled, unverified' if enable_delivery else 'muted')
    elif enable_delivery: raise ValueError('Delivery opt-in requires external configuration')
    # Alertmanager forbids mute timings on the root. A final matching-all child
    # makes the fallback unreachable for delivery without relying on SMTP=false.
    routes.append({'receiver':'rims-disabled',**mute})
    doc={'apiVersion':1,'contactPoints':contacts,'policies':[{'orgId':1,'receiver':'rims-disabled','group_by':['environment','data_mode','warehouse_id','alertname'],'group_wait':'30s','group_interval':'5m','repeat_interval':'4h','routes':routes}],
         'muteTimes':[{'orgId':1,'name':'rims-delivery-disabled','time_intervals':[{'times':[{'start_time':'00:00','end_time':'24:00'}]}]}]}
    if mode!='external':doc['deleteContactPoints']=[{'orgId':1,'uid':'rims-live-telegram'},{'orgId':1,'uid':'rims-live-email'},{'orgId':1,'uid':'rims-technical-email'}]
    return doc,{'configuration':mode,'dataMode':data_mode,'environment':environment,'delivery':'enabled, unverified' if enable_delivery else 'muted','technicalReceiver':technical}
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=['muted','local','external'],default='muted')
    p.add_argument('--data-mode',choices=['live','mock'],default='live')
    p.add_argument('--environment',default='local')
    p.add_argument('--config-root',type=Path,default=ROOT)
    p.add_argument('--targets',type=Path)
    p.add_argument('--env-file',type=Path)
    p.add_argument('--output',type=Path)
    p.add_argument('--enable-delivery',action='store_true')
    p.add_argument('--preflight',action='store_true')
    a=p.parse_args(); settings={}
    if a.env_file:
        for line in a.env_file.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k,v=line.split('=',1); settings[k]=v.strip().strip('"').strip("'")
    settings.update(os.environ)
    targets=a.targets or a.config_root/'runtime'/('live-'+a.environment)/'prometheus/live/targets.yml'
    try: doc,report=render(a.config_root,'muted' if a.mode=='local' else a.mode,a.data_mode,a.environment,targets,settings,a.enable_delivery)
    except (ValueError,OSError) as ex: p.exit(1,str(ex)+'\n')
    if not a.preflight:
        out=a.output or a.config_root/'runtime/notifications.json';out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');out.chmod(0o600)
    print(json.dumps(report,ensure_ascii=False));print('No messages sent. Contact configuration is not delivery evidence.')
if __name__=='__main__': main()

