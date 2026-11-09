# Coop Dungeon Crawler - one-line launcher for Windows PowerShell.
#   irm __BASE__/play.ps1 | iex
$ErrorActionPreference = 'Stop'
$base = '__BASE__'
$server = '__SERVER__'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$dir = Join-Path $env:LOCALAPPDATA 'coop-dungeon-crawler'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir 'cdc.exe'
$verFile = Join-Path $dir 'version'
$remote = try { (Invoke-RestMethod "$base/dl/version").Trim() } catch { '' }
$local = if (Test-Path $verFile) { (Get-Content $verFile -Raw).Trim() } else { '' }
if (-not (Test-Path $exe) -or ($remote -and $remote -ne $local)) {
  Write-Host "Downloading Coop Dungeon Crawler (windows/$arch)..." -ForegroundColor Yellow
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest "$base/dl/cdc-windows-$arch.exe" -OutFile $exe -UseBasicParsing
  if ($remote) { Set-Content -Path $verFile -Value $remote }
}
& $exe -server $server
