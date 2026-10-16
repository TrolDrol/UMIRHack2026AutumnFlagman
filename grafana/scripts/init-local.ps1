[CmdletBinding()]
param([switch]$LegacyMock)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$secretsDir = Join-Path $taskRoot 'secrets'
New-Item -ItemType Directory -Force $secretsDir | Out-Null
foreach ($name in @('admin_password','viewer_password','secret_key')) {
    $path = Join-Path $secretsDir $name
    if (!(Test-Path -LiteralPath $path)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        [IO.File]::WriteAllText($path,[Convert]::ToBase64String($bytes),[Text.UTF8Encoding]::new($false))
    }
}
if (!(Test-Path (Join-Path $secretsDir 'smtp_password'))) { [IO.File]::WriteAllText((Join-Path $secretsDir 'smtp_password'),'',[Text.UTF8Encoding]::new($false)) }
if($LegacyMock){
    if (!(Test-Path (Join-Path $taskRoot '.env'))) { Copy-Item (Join-Path $taskRoot '.env.example') (Join-Path $taskRoot '.env') }
    python (Join-Path $PSScriptRoot 'configure-notifications.py') --mode muted --data-mode mock --environment demo
} else { python (Join-Path $PSScriptRoot 'prepare-live.py') --environment local }
if ($LASTEXITCODE) { throw 'Notification configuration failed' }
Write-Host 'Local secrets created. Admin password is in grafana/secrets/admin_password. Existing secrets preserved.'
