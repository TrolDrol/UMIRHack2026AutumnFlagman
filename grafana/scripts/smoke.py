"""Authenticated source-aware acceptance through the final Grafana URL. Read-only after API login."""
import argparse, base64, http.client, http.cookiejar, json, os, re, ssl, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def origin(url):
    u=urllib.parse.urlsplit(url)
    return u.scheme,u.hostname,u.port or (443 if u.scheme=='https' else 80)
class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if origin(req.full_url)!=origin(newurl): raise ValueError('Refusing cross-origin redirect; credentials not forwarded')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
def validate_source(query,environment,mode):
    def one(expr):
        rows=query(expr)
        assert len(rows)==1,(expr,'expected one nonempty authoritative series',len(rows))
        return rows[0]
    selector='environment="'+environment+'",data_mode="'+mode+'"'
    up=one('up{job="rims-business"}')
    assert up['metric'].get('environment')==environment and up['metric'].get('data_mode')==mode and float(up['value'][1])==1,'Wrong/down business target'
    source=one('rims_source_info{job="rims-business"}')
    assert source['metric'].get('source_kind')==mode and source['metric'].get('data_mode')==mode and source['metric'].get('environment')==environment and source['metric'].get('contract_version')=='1.0','Wrong source identity'
    expected=one('rims:source_expected')
    assert expected['metric'].get('environment')==environment and expected['metric'].get('data_mode')==mode and float(expected['value'][1])==1,'Wrong expected source'
    global_contract=one('rims:global_contract_missing{'+selector+'}')
    assert float(global_contract['value'][1])==0,'Global contract missing'
    if mode=='live':
        assert float(one('rims_source_roster_success{job="rims-business",'+selector+'}')['value'][1])==1,'Roster read failed; empty DB cannot hide this'
        age=float(one('time()-rims_source_roster_timestamp_seconds{job="rims-business",'+selector+'}')['value'][1])
        assert 0<=age<60,'Roster stale'
    return selector
class Smoke:
    def __init__(self,a):
        self.a=a;self.url=a.url.rstrip('/')
        u=urllib.parse.urlsplit(self.url)
        if u.scheme not in ['http','https'] or u.username or u.password or u.query or u.fragment or not u.path.endswith('/grafana'):raise ValueError('Use a canonical Grafana URL without credentials/query')
        if u.scheme=='http' and u.hostname not in ['localhost','127.0.0.1','::1']:raise ValueError('Remote credentials require HTTPS')
        if not re.fullmatch(r'[a-zA-Z0-9_-]+',a.environment):raise ValueError('Invalid environment')
        ctx=ssl.create_default_context(cafile=str(a.ca_file) if a.ca_file else None)
        self.opener=urllib.request.build_opener(SameOriginRedirect(),urllib.request.HTTPSHandler(context=ctx),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        password=(a.password_file or a.config_root/'secrets/admin_password').read_text(encoding='utf-8-sig').strip()
        self.password=password
        self.auth=base64.b64encode((a.username+':'+password).encode()).decode()
        self.base=urllib.parse.urlunsplit((u.scheme,u.netloc,u.path[:-len('/grafana')],'',''))
        self.roster=set()
        if a.warehouses:self.roster=set(filter(None,a.warehouses.split(',')))
        elif a.roster_file:
            d=json.loads(a.roster_file.read_text());self.roster=set(d['warehouseIds'] if isinstance(d,dict) else d)
        elif a.mode=='mock':self.roster={'demo-main','demo-cafe','demo-bar'}
    def request(self,url,headers=None,data=None,json_result=True):
        with self.opener.open(urllib.request.Request(url,headers=headers or {},data=data),timeout=15) as response:
            raw=response.read()
            return json.loads(raw) if json_result else (response.status,response.headers,raw)
    def get(self,path,token=None):
        return self.request(self.url+path,{'Authorization':'Basic '+(token or self.auth)})
    def query(self,expr):
        response=self.get('/api/datasources/proxy/uid/rims-prometheus/api/v1/query?'+urllib.parse.urlencode({'query':expr}))
        assert response['status']=='success',response.get('error','Prometheus query failed')
        return response['data']['result']
    def api_roster(self):
        settings={}
        for line in self.a.operator_env_file.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line:k,v=line.split('=',1);settings[k]=v
        token=self.request(self.base+'/api/v2/auth/csrf')['data']['requestToken']
        headers={'Origin':urllib.parse.urlunsplit((*urllib.parse.urlsplit(self.base)[:2],'','','')),'Content-Type':'application/json','X-CSRF-TOKEN':token}
        self.request(self.base+'/api/v2/auth/login',headers,json.dumps({'username':settings['Bootstrap__Username'],'password':settings['Bootstrap__Password']}).encode())
        self.roster={r['warehouseId'] for r in self.request(self.base+'/api/v2/me/memberships')['data']}
        return self.roster
    def browser_checks(self):
        public=urllib.parse.urlsplit(self.url)
        headers={'Origin':urllib.parse.urlunsplit((public.scheme,public.netloc,'','','')),'Content-Type':'application/json'}
        login=self.request(self.url+'/login',headers,json.dumps({'user':self.a.username,'password':self.password}).encode())
        assert login.get('message')=='Logged in','Grafana session login failed'
        _,_,html=self.request(self.url,json_result=False)
        assets=re.findall(r'<script[^>]+src="([^"]*public/build/[^"]+\.js)"',html.decode())
        assert assets,'Grafana build assets missing'
        asset=urllib.parse.urljoin(self.url+'/',assets[0])
        assert origin(asset)==origin(self.url),'Unexpected external Grafana asset origin'
        status,asset_headers,content=self.request(asset,json_result=False)
        assert status==200 and content and 'javascript' in asset_headers.get('Content-Type',''),'Grafana asset unavailable'
        cls=http.client.HTTPSConnection if public.scheme=='https' else http.client.HTTPConnection
        options={'timeout':15}
        if public.scheme=='https':options['context']=ssl.create_default_context(cafile=str(self.a.ca_file) if self.a.ca_file else None)
        connection=cls(public.hostname,public.port or (443 if public.scheme=='https' else 80),**options)
        try:
            connection.request('GET',public.path+'/api/live/ws',headers={'Authorization':'Basic '+self.auth,'Origin':headers['Origin'],'Connection':'Upgrade','Upgrade':'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':base64.b64encode(os.urandom(16)).decode()})
            assert connection.getresponse().status==101,'Grafana WebSocket upgrade failed'
        finally:connection.close()
    def run(self):
        a=self.a
        if a.operator_env_file:self.api_roster()
        if a.mode=='live' and not self.roster and not (a.empty_roster or a.operator_env_file or a.roster_file):raise ValueError('Pass verified --warehouses, --roster-file, --operator-env-file or explicit --empty-roster')
        assert self.get('/api/health')['database']=='ok'
        assert self.get('/api/frontend/settings').get('appUrl')==self.url+'/', 'Grafana public root URL does not match final URL'
        assert self.get('/api/datasources/uid/rims-prometheus')['url']=='http://prometheus:9090','Unexpected datasource endpoint'
        targets=self.get('/api/datasources/proxy/uid/rims-prometheus/api/v1/targets')['data']['activeTargets']
        business=[t for t in targets if t.get('labels',{}).get('job')=='rims-business']
        assert len(business)==1 and business[0]['health']=='up','Wrong active business target count/health'
        if a.mode=='live': assert business[0]['scrapeUrl']=='http://backend:8080/metrics','Grafana routes to legacy/wrong exporter'
        selector=validate_source(self.query,a.environment,a.mode)
        def values(name):
            return self.query(name+'{'+selector+'}')
        def warehouse_rows(name):
            rows=values(name);assert {r['metric'].get('warehouse_id') for r in rows}==self.roster,(name,'warehouse roster mismatch')
            assert len(rows)==len(self.roster),(name,'duplicate warehouse samples')
            return rows
        warehouse_rows('rims_warehouse_info')
        assert all(float(r['value'][1])==1 for r in warehouse_rows('rims_snapshot_success')),'Snapshot failed'
        stamps=warehouse_rows('rims_snapshot_timestamp_seconds')
        ages=self.query('time()-rims_snapshot_timestamp_seconds{'+selector+'}')
        assert len(ages)==len(stamps) and all(0<=float(r['value'][1])<60 for r in ages),'Snapshot stale/missing'
        assert all(float(r['value'][1])==0 for r in warehouse_rows('rims:contract_missing')),'Warehouse contract missing'
        expected_rules=13 if a.mode=='live' else 12
        for uid in ['rims-overview','rims-inventory','rims-orders','rims-telemetry']:
            d=self.get('/api/dashboards/uid/'+uid)['dashboard']
            assert d['uid']==uid
            if a.mode=='live':
                v={v['name']:v for v in d['templating']['list']}
                assert v['environment']['current']['value']==a.environment and v['data_mode']['current']['value']=='live','Wrong dashboard defaults'
                assert v['warehouse']['current']['value']=='$__all' and v['warehouse']['includeAll'],'Wrong warehouse defaults'
                text=json.dumps(d,ensure_ascii=False).lower()
                assert not any(s in text for s in ['mock:','синтетическ','будущий backend','demo-main','demo-cafe','demo-bar']),'Misleading live dashboard text'
            for panel in d['panels']:
                for t in panel.get('targets',[]):
                    expr=t['expr'].replace('${warehouse:regex}','|'.join(sorted(self.roster)) or 'a^').replace('$environment',a.environment).replace('$data_mode',a.mode).replace('$__rate_interval','1m').replace('$__range','1h')
                    self.query(expr)
        rules=self.get('/api/v1/provisioning/alert-rules')
        assert len(rules)==expected_rules,('unexpected alert rules',len(rules))
        assert all(r['noDataState']=='NoData' and r['execErrState']=='Error' for r in rules),'Unsafe alert no-data/error policy'
        assert all('$environment' not in d['model'].get('expr','') for r in rules for d in r['data'])
        if a.mode=='live': assert any(r['uid']=='rims-roster-unavailable' for r in rules)
        assert any('$values.B.Value' in r['annotations']['description'] for r in rules),'Damaged templates'
        evaluated=[r for g in self.get('/api/prometheus/grafana/api/v1/rules')['data']['groups'] for r in g['rules']]
        source_rules={'rims-source-down','rims-source-missing','rims-global-contract-missing','rims-roster-unavailable'}
        assert len(evaluated)==expected_rules and all(r.get('health')=='ok' or (not self.roster and r.get('health')=='nodata' and r.get('uid') not in source_rules) for r in evaluated),'Alert evaluation error'
        policy=self.get('/api/v1/provisioning/policies')
        def muted(routes):
            return all(r.get('mute_time_intervals')==['rims-delivery-disabled'] and muted(r.get('routes',[])) for r in routes)
        assert policy['receiver']=='rims-disabled','Unsafe default receiver'
        if a.notification_mode!='external-enabled':
            assert muted(policy.get('routes',[])),'Delivery is not muted'
        else:
            routes=policy.get('routes',[])
            assert len(routes)==4 and all(not r.get('mute_time_intervals') and not r.get('active_time_intervals') for r in routes[:-1]),'External delivery routes are not enabled'
            assert [r['receiver'] for r in routes[:-1]]==['rims-technical','rims-technical','rims-live'],'Wrong enabled receivers'
        if a.mode=='live':
            fallback=policy.get('routes',[])[-1] if policy.get('routes') else {}
            assert fallback.get('receiver')=='rims-disabled' and fallback.get('mute_time_intervals')==['rims-delivery-disabled'] and not fallback.get('object_matchers') and not fallback.get('matchers'),'Missing unconditional muted fallback'
        contacts=self.get('/api/v1/provisioning/contact-points')
        assert contacts and any(c['name']=='rims-disabled' for c in contacts),'Missing disabled receiver'
        if a.notification_mode=='muted':assert all(c['name']=='rims-disabled' for c in contacts),'Unexpected external contacts'
        timings=[m for m in self.get('/api/v1/provisioning/mute-timings') if m['name']=='rims-delivery-disabled']
        assert len(timings)==1 and timings[0]['time_intervals']==[{'times':[{'start_time':'00:00','end_time':'24:00'}]}],'Runtime mute must cover every day, all day'
        if a.notification_mode.startswith('external-'):
            assert {c['type'] for c in contacts if c['name']=='rims-live'}=={'telegram','email'},'External live receiver must contain Telegram and email'
        self.browser_checks()
        report={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','url':self.url,'environment':a.environment,'dataMode':a.mode,'warehouseIds':sorted(self.roster),'dashboards':4,'alertRules':expected_rules,'liveSource':'verified' if a.mode=='live' else 'legacy mock','publicRouting':'verified through this URL only','alertEvaluation':'verified','delivery':'muted; not sent or verified'}
        report['notificationMode']=a.notification_mode
        if a.notification_mode=='external-enabled':report['delivery']='enabled in runtime policy; receipt not verified'
        if a.evidence:
            a.evidence.parent.mkdir(parents=True,exist_ok=True);a.evidence.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
        return report
def arguments(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('--url',default='http://localhost:3288/grafana');p.add_argument('--mode',choices=['live','mock'],default='live');p.add_argument('--environment',default='local')
    group=p.add_mutually_exclusive_group();group.add_argument('--warehouses');group.add_argument('--empty-roster',action='store_true');group.add_argument('--roster-file',type=Path);group.add_argument('--operator-env-file',type=Path)
    p.add_argument('--username',default='monitor-admin');p.add_argument('--password-file',type=Path);p.add_argument('--config-root',type=Path,default=root);p.add_argument('--ca-file',type=Path);p.add_argument('--evidence',type=Path);p.add_argument('--notification-mode',choices=['muted','external-muted','external-enabled'],default='muted')
    return p.parse_args(argv)
def initialize(argv=None):
    global a,roster,get,query,client,auth
    a=arguments(argv);client=Smoke(a);roster=client.roster;get=client.get;query=client.query;auth=client.auth
def run():
    return client.run()
if __name__=='__main__':
    initialize();run()

