param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$BackupRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups'),
  [string]$PgDumpPath = 'pg_dump'
)

$ErrorActionPreference = 'Stop'

function Read-EnvFile {
  param([string]$Path)
  $values = @{}
  if (!(Test-Path -LiteralPath $Path)) {
    throw "Missing .env file at $Path"
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $parts = $trimmed.Split('=', 2)
    if ($parts.Count -ne 2) { continue }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }

  return $values
}

$envValues = Read-EnvFile -Path (Join-Path $ProjectRoot '.env')
if (-not $envValues.ContainsKey('DATABASE_URL') -or -not $envValues['DATABASE_URL']) {
  throw 'DATABASE_URL is required for PostgreSQL backups.'
}

$databaseUri = [System.Uri]$envValues['DATABASE_URL']
$dbHost = $databaseUri.Host
$dbPort = if ($databaseUri.Port -gt 0) { [string]$databaseUri.Port } else { '5432' }
$dbName = $databaseUri.AbsolutePath.TrimStart('/')
$userInfo = $databaseUri.UserInfo.Split(':', 2)
$dbUser = [System.Uri]::UnescapeDataString($userInfo[0])
$dbPass = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { '' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$dumpFile = Join-Path $backupDir "$dbName.sql"
$uploadsDir = Join-Path $ProjectRoot 'uploads_pdf'
$uploadsZip = Join-Path $backupDir "uploads_pdf-$timestamp.zip"

$previousPassword = $env:PGPASSWORD
try {
  if ($dbPass) {
    $env:PGPASSWORD = $dbPass
  }

  & $PgDumpPath `
    '--host' $dbHost `
    '--port' $dbPort `
    '--username' $dbUser `
    '--dbname' $dbName `
    '--file' $dumpFile `
    '--format' 'plain' `
    '--clean' `
    '--if-exists'
} finally {
  $env:PGPASSWORD = $previousPassword
}

if (Test-Path -LiteralPath $uploadsDir) {
  Compress-Archive -Path (Join-Path $uploadsDir '*') -DestinationPath $uploadsZip -Force
}

Write-Host "Backup created:"
Write-Host "  Database: $dumpFile"
if (Test-Path -LiteralPath $uploadsZip) {
  Write-Host "  Uploads:  $uploadsZip"
}
