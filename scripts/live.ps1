[CmdletBinding()]
param(
    [ValidateSet('config','build','up','ready','stop','logs','bootstrap','rotate-instance','metadata')][string]$Action='config',
    [string]$EnvFile='live.env',
    [ValidatePattern('^$|^[a-z0-9][a-z0-9_-]*$')][string]$ProjectName='',
    [switch]$Monitoring,
    [switch]$Staging,
    [ValidateSet('muted','external-muted')][string]$NotificationMode='muted',
    [switch]$AllowNotificationProfileChange
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskEnv=if([IO.Path]::IsPathRooted($EnvFile)){$EnvFile}else{Join-Path $PSScriptRoot $EnvFile}
$taskCompose=@('compose','--env-file',$taskEnv,'-f',(Join-Path $PSScriptRoot 'compose.live.yml'))
if($ProjectName){$taskCompose+=@('-p',$ProjectName)}
if($Staging){$taskCompose+=@('-f',(Join-Path $PSScriptRoot 'compose.staging.yml'))}
if($Monitoring){
    $taskEnvironment=if($Staging){'staging'}else{'local'}
    $taskScope=if($ProjectName){$ProjectName}else{'rims-live-local'}
    $taskBundle=Join-Path $PSScriptRoot "../grafana/runtime/live-$taskEnvironment-$taskScope"
    $env:RIMS_MONITORING_BUNDLE=[IO.Path]::GetFullPath($taskBundle)
    if($Action -in @('config','build','up')) {
        $taskManifest=Join-Path $taskBundle 'manifest.json'
        if(Test-Path -LiteralPath $taskManifest){
            $taskPreviousMode=([IO.File]::ReadAllText($taskManifest)|ConvertFrom-Json).notificationMode
            if($taskPreviousMode -ne $NotificationMode -and -not $AllowNotificationProfileChange){throw 'Notification profile change requires explicit -AllowNotificationProfileChange'}
        }
        & python (Join-Path $PSScriptRoot '../grafana/scripts/prepare-live.py') --environment $taskEnvironment --output-dir $taskBundle --notification-mode $NotificationMode --env-file $taskEnv
        if($LASTEXITCODE){throw 'Live monitoring generation/preflight failed'}
    }
    $taskCompose+=@('-f',(Join-Path $PSScriptRoot 'compose.monitoring.yml'))
    if($NotificationMode -eq 'external-muted'){$taskCompose+=@('-f',(Join-Path $PSScriptRoot 'compose.notifications.external.yml'))}
    if($NotificationMode -eq 'external-muted' -and [IO.File]::ReadAllText($taskEnv) -match '(?m)^RIMS_NOTIFICATION_IPV6=true\r?$'){
        $taskCompose+=@('-f',(Join-Path $PSScriptRoot 'compose.notifications.ipv6.yml'))
    }
}
function Invoke-Live([string[]]$Arguments){ & docker @taskCompose @Arguments; if($LASTEXITCODE-ne 0){throw "Docker compose failed: $Action"} }
switch($Action){
 'config' { Invoke-Live @('config','--quiet') }
 'build' { if($Staging){throw 'Build and tag immutable images before staging; staging does not build sources'}; Invoke-Live @('build') }
 'up' {
    $taskNoBuild=if($Staging){@('--no-build')}else{@()}
    # Compose runs the single migration service after DB health and before API.
    # Do not run a second disposable migration command ahead of the same job.
    Invoke-Live (@('up','-d')+$taskNoBuild)
    Write-Host 'Run -Action ready and authenticated acceptance, then -Action metadata. Static health is not API readiness.'
 }
 'ready' { Invoke-Live @('exec','-T','frontend','wget','-q','-O','-','http://backend:8080/health/ready') }
 'stop' { Invoke-Live @('stop') }
 'logs' { Invoke-Live @('logs','--tail','100') }
 'bootstrap' { if(-not $env:Bootstrap__Username -or -not $env:Bootstrap__Password){throw 'Set Bootstrap__Username and Bootstrap__Password (12+ characters) in current process'}; Invoke-Live @('run','--rm','-e','Bootstrap__Username','-e','Bootstrap__Password','migrate','bootstrap-admin') }
 'rotate-instance' { Invoke-Live @('run','--rm','migrate','rotate-instance') }
 'metadata' {
    $taskImages=& docker @taskCompose images --format json
    if($LASTEXITCODE-ne 0){throw 'Cannot read release images'}
    $taskRuntime=& docker @taskCompose exec -T frontend wget -q -O - http://backend:8080/api/v2/runtime
    if($LASTEXITCODE-ne 0){throw 'Cannot read backend runtime'}
    $taskMigrations='SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";' | & docker @taskCompose exec -T db psql -U rims -d rims -At -v ON_ERROR_STOP=1
    if($LASTEXITCODE-ne 0){throw 'Cannot read migration journal'}
    $taskRevision=& git -C (Join-Path $PSScriptRoot '..') rev-parse HEAD
    $taskDirty=& git -C (Join-Path $PSScriptRoot '..') status --porcelain
    $taskImagesText=$taskImages -join "`n"
    $taskImageRows=if($taskImagesText.TrimStart().StartsWith('[')){ConvertFrom-Json $taskImagesText}else{@($taskImages|ForEach-Object{ConvertFrom-Json $_})}
    $taskMetadata=@{utc=(Get-Date).ToUniversalTime().ToString('o');revision=$taskRevision;dirty=[bool]$taskDirty;images=$taskImageRows;runtime=(ConvertFrom-Json ($taskRuntime -join "`n")).data;migrations=@($taskMigrations);staging=[bool]$Staging}
    $taskArtifacts=Join-Path $PSScriptRoot '.artifacts'
    New-Item -ItemType Directory -Path $taskArtifacts -Force | Out-Null
    $taskOutput=Join-Path $taskArtifacts ('release-'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')+'.json')
    [IO.File]::WriteAllText($taskOutput,($taskMetadata|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
    Write-Host "Release metadata: $taskOutput"
 }
}
