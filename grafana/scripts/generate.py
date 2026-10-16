"""Deterministically generate reviewable dashboards and alert queries. No secrets."""
import json
import argparse
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--mode', choices=['live', 'mock'], default='live')
p.add_argument('--environment', choices=['local', 'staging', 'demo'], default='local')
p.add_argument('--output-root', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime/live-local')
args = p.parse_args()
ROOT = args.output_root
LIVE = args.mode == 'live'
def write(path, value):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

SCOPE = 'job="rims-business",environment="$environment",data_mode="$data_mode"'
W = SCOPE + ',warehouse_id=~"${warehouse:regex}"'
K = 'environment, data_mode, warehouse_id'
O = 'environment, data_mode, operation'
def metric(name, extra='', warehouse=True):
    return name + '{' + (W if warehouse else SCOPE) + (',' + extra if extra else '') + '}'
def panel(title, expr, unit='short', kind='timeseries', instant=False):
    return {'title': title, 'type': kind, 'datasource': {'type': 'prometheus', 'uid': 'rims-prometheus'},
            'targets': [{'refId': 'A', 'expr': expr, 'instant': instant, 'range': not instant, 'format': 'table' if kind == 'table' else 'time_series', 'legendFormat': '{{warehouse_id}} {{state}} {{source}} {{result}} {{operation}} {{outcome}}'}],
            'fieldConfig': {'defaults': {'unit': unit, 'noValue': 'Нет данных', 'color': {'mode': 'palette-classic'}}, 'overrides': []},
            'options': {'legend': {'displayMode': 'list', 'placement': 'bottom'}, 'tooltip': {'mode': 'multi'}}}

stopped = f'100 * sum by ({K}) ({metric("rims_menu_dishes", "state=\"stopped\"")}) / (sum by ({K}) ({metric("rims_menu_dishes", "state=~\"available|stopped\"")}) > 0)'
orders = metric('rims_orders_total')
quantile = lambda q: f'histogram_quantile({q}, sum by ({O}, le) (rate({metric("rims_api_request_duration_seconds_bucket", warehouse=False)}[$__rate_interval])))'
overview = [
    panel('Источник и версия контракта' if LIVE else 'Источник MOCK / LIVE и версия контракта', metric('rims_source_info', warehouse=False), kind='table', instant=True),
    panel('Последний успешный снимок', metric('rims_snapshot_timestamp_seconds')+' * 1000', 'dateTimeAsIso', 'stat', True),
    panel('Возраст снимка — старые данные требуют проверки', 'time() - '+metric('rims_snapshot_timestamp_seconds'), 's'),
    panel('Просроченные партии', metric('rims_inventory_batches', 'state="expired"')),
    panel('Риск истечения партий', metric('rims_inventory_batches', 'state="expiring"')),
    panel('Блюда в стоп-листе', metric('rims_menu_dishes', 'state="stopped"')),
    panel('Горячие предложения', metric('rims_hot_offers')),
    panel('Ожидающие поставки', metric('rims_deliveries_pending')),
    panel('Заказы за выбранный период', f'sum by ({K}, result) (increase({orders}[$__range]))', kind='stat', instant=True),
]
inventory = [
    panel('Склады и категории партий', metric('rims_inventory_batches')+f' * on({K}) group_left(warehouse_name) '+metric('rims_warehouse_info'), kind='table', instant=True),
    panel('Низкий запас ингредиентов', metric('rims_inventory_low_stock_ingredients')),
    panel('Отсутствующие ингредиенты (пересекаются с низким запасом)', metric('rims_inventory_out_of_stock_ingredients')),
    panel('Стоп-лист среди активных блюд', stopped, 'percent'),
    panel('Горячие предложения', metric('rims_hot_offers')),
    panel('Ожидающие поставки', metric('rims_deliveries_pending')),
    panel('Возраст старейшей поставки от создания', metric('rims_oldest_pending_delivery_age_seconds'), 's'),
    panel('Документы списания за период по причинам', f'increase({metric("rims_writeoffs_total")}[$__range])', kind='stat', instant=True),
]
order_panels = [
    panel('Скорость заказов по источникам и результатам', f'sum by ({K}, source, result) (rate({orders}[$__rate_interval]))', 'ops'),
    panel('Прирост намерений за период', f'increase({orders}[$__range])', kind='stat', instant=True),
    panel('Бизнес-отказы за 5 минут, %', f'100 * sum by ({K}) (increase({metric("rims_orders_total", "result=\"rejected\"")}[5m])) / (sum by ({K}) (increase({orders}[5m])) > 0)', 'percent'),
    panel('Число намерений за 5 минут', f'sum by ({K}) (increase({orders}[5m]))'),
    panel('Подтверждения поставок за период', f'increase({metric("rims_deliveries_confirmed_total")}[$__range])', kind='stat', instant=True),
    panel('Время обработки запросов API p50' if LIVE else 'Синтетические длительности mock p50', quantile(.5), 's'),
    panel('Время обработки запросов API p95' if LIVE else 'Синтетические длительности mock p95', quantile(.95), 's'),
    panel('HTTP-наблюдения по operation/outcome — весь выбранный источник', f'sum by ({O}, outcome) (increase({metric("rims_api_request_duration_seconds_count", warehouse=False)}[$__range]))'),
]
telemetry = [
    panel('Доступность exporter (реальный scrape)', 'up{'+SCOPE+'}'),
    panel('Доступность Prometheus', 'up{job="prometheus"}'),
    panel('Успех последней попытки снимка', metric('rims_snapshot_success')),
    panel('Возраст снимка', 'time() - '+metric('rims_snapshot_timestamp_seconds'), 's'),
    panel('Нарушение контракта (1 — проблема)', 'rims:contract_missing{environment="$environment",data_mode="$data_mode",warehouse_id=~"${warehouse:regex}"}'),
    panel('Глобальный контракт источника (1 — проблема)' if LIVE else 'Глобальный контракт MOCK (1 — проблема)', 'rims:global_contract_missing{environment="$environment",data_mode="$data_mode"}'),
    panel('Источник / версия', metric('rims_source_info', warehouse=False), kind='table', instant=True),
    {'type':'text','title':'Правила Grafana Alerting','options':{'mode':'markdown','content':'[Состояния правил и история уведомлений](/grafana/alerting/list). up=1 не доказывает свежесть снимков. Доставка уведомлений проверяется отдельно.'}},
]
if LIVE:
    telemetry.append(panel('Успех чтения списка складов', metric('rims_source_roster_success', warehouse=False)))
    telemetry.append(panel('Возраст успешного чтения списка складов', 'time() - '+metric('rims_source_roster_timestamp_seconds', warehouse=False), 's'))
for uid, title, panels in [('rims-overview','Обзор RIMS',overview),('rims-inventory','Склад и меню',inventory),('rims-orders','Заказы и длительности',order_panels),('rims-telemetry','Телеметрия',telemetry)]:
    banner = {'type':'text','title':'Режим: $data_mode · Среда: $environment','options':{'mode':'markdown','content':'**MOCK: синтетические данные; не связаны с заказами в браузере.** LIVE показывается только после подключения backend. Пустые окна после старта ожидаемы. Проверяйте возраст и успех снимка; старые значения сохраняются при ошибке.'},'gridPos':{'x':0,'y':0,'w':24,'h':3},'id':1}
    if LIVE:
        banner['options']['content'] = '**Источник: сервер приложения ASP.NET / PostgreSQL.** Среда: $environment. Проверяйте успех и возраст снимка: при отказе чтения сохраняются последние успешные значения. Учебные записи в SQL остаются учебными; пустой список складов допустим только при успешном чтении источника.'
    for i,p in enumerate(panels):
        p['id']=i+2; p['gridPos']={'x':(i%2)*12,'y':3+(i//2)*8,'w':12,'h':8}
    variables = []
    for name,query,current,multi in [
        ('environment','label_values(rims_source_info{job="rims-business"},environment)','demo',False),
        ('data_mode','label_values(rims_source_info{job="rims-business",environment="$environment"},data_mode)','mock',False),
        ('warehouse','label_values(rims_warehouse_info{job="rims-business",environment="$environment",data_mode="$data_mode"},warehouse_id)',['demo-main','demo-cafe','demo-bar'],True)]:
        variables.append({'name':name,'type':'query','datasource':{'uid':'rims-prometheus','type':'prometheus'},'query':query,'refresh':1,'multi':multi,'includeAll':False,'current':{'text':current,'value':current},'sort':1})
    if LIVE:
        for variable in variables:
            value = {'environment': args.environment, 'data_mode': 'live', 'warehouse': '$__all'}[variable['name']]
            variable['current'] = {'text': 'All' if value == '$__all' else value, 'value': value, 'selected': True}
            if variable['name'] == 'warehouse': variable['includeAll'] = True
            else: variable.update(type='constant', query=value, hide=2 if variable['name'] == 'data_mode' else 0)
    write('grafana/dashboards/'+uid+'.json',{'uid':uid,'title':title,'schemaVersion':41,'version':1,'editable':False,'tags':['RIMS','observability'],'timezone':'browser','refresh':'15s','time':{'from':'now-1h','to':'now'},'templating':{'list':variables},'panels':[banner]+panels,'links':[{'title':t,'url':'/grafana/d/'+u,'type':'link','includeVars':True} for u,t in [('rims-overview','Обзор'),('rims-inventory','Склад'),('rims-orders','Заказы'),('rims-telemetry','Телеметрия')]]})

# Recording rules retain environment/data_mode and never depend on dashboard variables.
rules=[]
def record(name,expr): rules.append({'record':name,'expr':expr})
M=lambda name,extra='': name+'{job="rims-business"'+(','+extra if extra else '')+'}'
record('rims:orders_attempts_5m',f'sum by ({K}) (increase({M("rims_orders_total")}[5m]))')
record('rims:orders_rejected_5m',f'sum by ({K}) (increase({M("rims_orders_total", "result=\"rejected\"")}[5m]))')
record('rims:order_rejections_signal','(rims:orders_rejected_5m / clamp_min(rims:orders_attempts_5m, 1) > bool 0.20) * (rims:orders_attempts_5m >= bool 10)')
record('rims:api_p95_5m',f'histogram_quantile(0.95, sum by ({O}, le) (rate({M("rims_api_request_duration_seconds_bucket")}[5m])))')
record('rims:api_count_5m',f'sum by ({O}) (increase({M("rims_api_request_duration_seconds_count")}[5m]))')
record('rims:slow_api_signal','(rims:api_p95_5m > bool 1) * (rims:api_count_5m >= bool 20)')
record('rims:stop_ratio',f'sum by ({K}) ({M("rims_menu_dishes", "state=\"stopped\"")}) / clamp_min(sum by ({K}) ({M("rims_menu_dishes", "state=~\"available|stopped\"")}), 1)')
record('rims:snapshot_stale',f'clamp_max((time() - {M("rims_snapshot_timestamp_seconds")} > bool 90) + on({K}) ({M("rims_snapshot_success")} == bool 0), 1)')
record('rims:source_missing', 'rims:source_expected unless on(environment, data_mode) up{job="rims-business"} or on(environment, data_mode) (0 * rims:source_expected)')
roster=f'max by ({K}) ({M("rims_warehouse_info")})'
checks=[]
def required(name,extra=''):
    checks.append(f'({roster} unless on({K}) max by ({K}) ({M(name,extra)}))')
for name in ['rims_snapshot_timestamp_seconds','rims_snapshot_success','rims_inventory_low_stock_ingredients','rims_inventory_out_of_stock_ingredients','rims_hot_offers','rims_deliveries_pending','rims_oldest_pending_delivery_age_seconds','rims_deliveries_confirmed_total']: required(name)
for state in ['fresh','expiring','expired','empty']: required('rims_inventory_batches',f'state="{state}"')
for state in ['available','stopped','inactive']: required('rims_menu_dishes',f'state="{state}"')
for source in ['staff','waiter','customer','integration']:
    for result in ['accepted','rejected']: required('rims_orders_total',f'source="{source}",result="{result}"')
for reason in ['expired','damaged']: required('rims_writeoffs_total',f'reason="{reason}"')
record('rims:contract_missing',f' or on({K}) '.join(checks)+f' or on({K}) (0 * {roster})')
global_roster='rims:source_expected'
global_checks=[]
for mode in [args.mode]:
    global_checks.append(f'(rims:source_expected{{data_mode="{mode}"}} unless on(environment, data_mode) {M("rims_source_info",f"source_kind=\"{mode}\",contract_version=\"1.0\"")})')
for op in ['order_create','delivery_create','delivery_confirm','menu_read']:
    for outcome in ['success','error']:
        for suffix in ['count','sum']:
            global_checks.append(f'({global_roster} unless on(environment, data_mode) {M("rims_api_request_duration_seconds_"+suffix,f"operation=\"{op}\",outcome=\"{outcome}\"")})')
        for le in ['0.01','0.025','0.05','0.1','0.25','0.5','1','2.5','5','10','+Inf']:
            # Prometheus 3 canonicalizes integer histogram bounds to 1.0/5.0/10.0.
            bound = f'le=~"{le}([.]0)?"' if le in ['1','5','10'] else f'le="{le}"'
            global_checks.append(f'({global_roster} unless on(environment, data_mode) {M("rims_api_request_duration_seconds_bucket",f"operation=\"{op}\",outcome=\"{outcome}\",{bound}")})')
record('rims:global_contract_missing',' or on(environment, data_mode) '.join(global_checks)+' or on(environment, data_mode) (0 * rims:source_expected)')
if LIVE:
    for name in ['rims_source_roster_success', 'rims_source_roster_timestamp_seconds']:
        global_checks.append(f'({global_roster} unless on(environment, data_mode) {M(name)})')
    rules[-1]['expr'] = ' or on(environment, data_mode) '.join(global_checks)+' or on(environment, data_mode) (0 * rims:source_expected)'
    record('rims:roster_unavailable', 'clamp_max((rims_source_roster_success{job="rims-business",data_mode="live"} == bool 0) + on(environment,data_mode) (time() - rims_source_roster_timestamp_seconds{job="rims-business",data_mode="live"} > bool 90), 1) or on(environment,data_mode) (rims:source_expected{data_mode="live"} unless on(environment,data_mode) rims_source_roster_success{job="rims-business",data_mode="live"})')
write('prometheus/recording-rules.yml',{'groups':[{'name':'rims-business','interval':'30s','rules':rules}]})

alert_specs=[
 ('expired-stock',M('rims_inventory_batches','state="expired"'),0,'gt','1m','critical','inventory',2,'Просроченные партии','Проверьте списание просроченных партий.'),
 ('expiry-risk',M('rims_inventory_batches','state="expiring"'),0,'gt','2m','warning','inventory',2,'Риск истечения','Проверьте горячие предложения и расход.'),
 ('low-stock',M('rims_inventory_low_stock_ingredients'),0,'gt','3m','warning','inventory',3,'Низкий запас','Проверьте пополнение ингредиентов.'),
 ('stop-list','rims:stop_ratio',.25,'gt','2m','warning','inventory',5,'Стоп-лист','Проверьте доступность ингредиентов и меню.'),
 ('supply-delay',M('rims_oldest_pending_delivery_age_seconds'),7200,'gt','5m','warning','inventory',8,'Долгая приёмка','Подтвердите или расследуйте ожидающую поставку.'),
 ('order-rejections','rims:order_rejections_signal',0,'gt','3m','warning','orders',4,'Бизнес-отказы >20%, намерений ≥10/5м','Проверьте дефицит; это не HTTP error rate.'),
 ('slow-api','rims:slow_api_signal',0,'gt','3m','warning','orders',8,'p95 >1с, наблюдений ≥20/5м','Проверьте время обработки запросов API.' if LIVE else 'MOCK: синтетическая длительность.'),
 ('source-down','up{job="rims-business"}',1,'lt','1m','critical','telemetry',2,'Источник недоступен','Проверьте контейнер и сеть.'),
 ('source-missing','rims:source_missing',0,'gt','1m','critical','telemetry',2,'Ожидаемый target исчез','Восстановите service discovery и target inventory.'),
 ('snapshot-stale','rims:snapshot_stale',0,'gt','1m','critical','telemetry',5,'Снимок устарел или неуспешен','Проверьте обновление снимков; up=1 недостаточно.'),
 ('contract-missing','rims:contract_missing',0,'gt','1m','critical','telemetry',6,'Отсутствует обязательная серия склада','Проверьте exporter и контракт 1.0.'),
 ('global-contract-missing','rims:global_contract_missing',0,'gt','1m','critical','telemetry',7,'Отсутствует глобальное семейство или неверен режим','Проверьте source_info и histogram контракт.'),
]
if LIVE:
    alert_specs.append(('roster-unavailable','rims:roster_unavailable',0,'gt','1m','critical','telemetry',10,'Список складов не прочитан или устарел','Проверьте доступ к PostgreSQL; пустая БД не равна отказу чтения.'))
alerts=[]
for uid,expr,threshold,evaluator,pending,severity,dashboard,panel_id,summary,action in alert_specs:
    alerts.append({'uid':'rims-'+uid,'title':'RIMS '+summary,'condition':'C','for':pending,'noDataState':'NoData','execErrState':'Error',
        'annotations':{'summary':summary,'description':'Значение: {{ $values.B.Value }}; порог: '+str(threshold)+'; '+action,'action':action,'__dashboardUid__':'rims-'+dashboard,'__panelId__':str(panel_id)},
        'labels':{'service':'rims','category':'telemetry' if 'source' in uid or 'contract' in uid or uid=='snapshot-stale' else 'business','severity':severity},
        'data':[
            {'refId':'A','relativeTimeRange':{'from':600,'to':0},'datasourceUid':'rims-prometheus','model':{'refId':'A','expr':expr,'instant':True,'range':False,'intervalMs':15000,'maxDataPoints':43200}},
            {'refId':'B','relativeTimeRange':{'from':0,'to':0},'datasourceUid':'__expr__','model':{'refId':'B','type':'reduce','expression':'A','reducer':'last','settings':{},'conditions':[{'type':'query','query':{'params':['B']},'reducer':{'type':'last','params':[]},'evaluator':{'type':'gt','params':[0]},'operator':{'type':'and'}}]}},
            {'refId':'C','relativeTimeRange':{'from':0,'to':0},'datasourceUid':'__expr__','model':{'refId':'C','type':'threshold','expression':'B','conditions':[{'type':'query','query':{'params':['C']},'reducer':{'type':'last','params':[]},'evaluator':{'type':evaluator,'params':[threshold]},'operator':{'type':'and'}}]}}
        ]})
write('grafana/provisioning/alerting/rules.json',{'apiVersion':1,'groups':[{'orgId':1,'name':'RIMS 30s','folder':'RIMS','interval':'30s','rules':alerts}]})
write('grafana/provisioning/alerting/templates.json',{'apiVersion':1,'templates':[{'orgID':1,'name':'rims.message','template':'''{{ define "rims.message" }}{{ if eq .CommonLabels.data_mode "mock" }}[DEMO][MOCK]{{ else if eq .CommonLabels.data_mode "live" }}[LIVE]{{ else }}[TELEMETRY]{{ end }}[{{ .Status | toUpper }}]
{{ range $i, $a := .Alerts }}{{ if lt $i 3 }}
{{ printf "%.80s" $a.Labels.alertname }} {{ printf "%.12s" $a.Labels.severity }} {{ printf "%.32s" $a.Labels.environment }} {{ printf "%.48s" $a.Labels.warehouse_id }} {{ printf "%.32s" $a.Labels.operation }}
{{ if eq $a.Annotations.grafana_state_reason "MissingSeries" }}Серия исчезла; восстановление не подтверждено.{{ else if $a.Annotations.Error }}Ошибка источника данных; состояние бизнеса не определено.
{{ printf "%.160s" $a.Annotations.Error }}{{ else if $a.Labels.datasource_uid }}Нет данных / ошибка выполнения правила; проверьте источник.{{ else }}{{ $a.Status }}: {{ printf "%.120s" $a.Annotations.summary }}{{ end }}
{{ if or $a.Annotations.Error $a.Labels.datasource_uid }}Проверьте доступность Prometheus, сеть и настройки datasource.{{ else }}{{ printf "%.160s" $a.Annotations.description }}
{{ printf "%.100s" $a.Annotations.action }}{{ end }}
Начало: {{ $a.StartsAt }}{{ if eq $a.Status "resolved" }} Конец: {{ $a.EndsAt }}{{ end }}
{{ printf "%.200s" $a.PanelURL }}
{{ end }}{{ end }}Всего: {{ len .Alerts }} (показано до 3).
{{ end }}'''}]})
if LIVE:
    template_path = ROOT / 'grafana/provisioning/alerting/templates.json'
    templates = json.loads(template_path.read_text(encoding='utf-8'))
    templates['templates'][0]['template'] = templates['templates'][0]['template'].replace('{{ if eq .CommonLabels.data_mode "mock" }}[DEMO][MOCK]{{ else if eq .CommonLabels.data_mode "live" }}[LIVE]{{ else }}[TELEMETRY]{{ end }}', '[LIVE]')
    write('grafana/provisioning/alerting/templates.json', templates)
print(f'Generated {args.environment}/{args.mode}: 4 dashboards and {len(alerts)} Grafana alerts.')
