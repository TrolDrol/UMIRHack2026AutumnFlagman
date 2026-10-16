"""Generate an environment-specific live bundle from source, never from leftover runtime."""
import argparse, importlib.util, json, shutil, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def prepare(root,destination,environment,notification_mode='muted',env_file=None):
    destination.mkdir(parents=True,exist_ok=True)
    for directory in ['datasources','dashboards']:
        shutil.copytree(root/'grafana/provisioning'/directory,destination/'grafana/provisioning'/directory,dirs_exist_ok=True)
    subprocess.run([sys.executable,str(root/'scripts/generate.py'),'--mode','live','--environment',environment,'--output-root',str(destination)],check=True)
    def write(relative,data):
        p=destination/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    write('prometheus/live/targets.yml',[{'targets':['backend:8080'],'labels':{'environment':environment,'data_mode':'live'}}])
    write('prometheus/live/expected-sources.yml',{'groups':[{'name':'rims-expected-sources','rules':[{'record':'rims:source_expected','expr':'vector(1)','labels':{'environment':environment,'data_mode':'live'}}]}]})
    write('prometheus/live/prometheus.yml',{'global':{'scrape_interval':'15s','scrape_timeout':'5s','evaluation_interval':'30s'},'rule_files':['/etc/prometheus/recording-rules.yml','/etc/prometheus/live/expected-sources.yml'],'scrape_configs':[{'job_name':'prometheus','static_configs':[{'targets':['localhost:9090']}]},{'job_name':'rims-business','file_sd_configs':[{'files':['/etc/prometheus/live/targets.yml'],'refresh_interval':'15s'}]}]})
    command=[sys.executable,str(root/'scripts/configure-notifications.py'),'--mode','external' if notification_mode=='external-muted' else 'muted','--data-mode','live','--environment',environment,'--config-root',str(root),'--targets',str(destination/'prometheus/live/targets.yml'),'--output',str(destination/'grafana/provisioning/alerting/notifications.json')]
    if env_file: command+=['--env-file',str(env_file)]
    subprocess.run(command,check=True)
    write('manifest.json',{'schema':1,'environment':environment,'dataMode':'live','sourceKind':'live','backendTarget':'backend:8080','dashboardUids':['rims-overview','rims-inventory','rims-orders','rims-telemetry'],'alertRules':13,'notificationMode':notification_mode,'delivery':'muted','rosterSignals':['rims_source_roster_success','rims_source_roster_timestamp_seconds']})
    return destination
def main():
    p=argparse.ArgumentParser();p.add_argument('--environment',choices=['local','staging'],default='local');p.add_argument('--config-root',type=Path,default=ROOT);p.add_argument('--output-dir',type=Path);p.add_argument('--notification-mode',choices=['muted','external-muted'],default='muted');p.add_argument('--env-file',type=Path)
    a=p.parse_args();destination=a.output_dir or a.config_root/'runtime'/('live-'+a.environment)
    prepare(a.config_root,destination,a.environment,a.notification_mode,a.env_file)
    print('Prepared live bundle: '+str(destination)+'; source history was not relabelled; delivery muted.')
if __name__=='__main__': main()

