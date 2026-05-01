param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$BackupRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups'),
  [string]$MysqlDumpPath = 'C:\xampps\mysql\bin\mysqldump.exe'
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
$dbHost = if ($envValues.ContainsKey('MYSQL_HOST') -and $envValues['MYSQL_HOST']) { $envValues['MYSQL_HOST'] } else { 'localhost' }
$dbUser = if ($envValues.ContainsKey('MYSQL_USER') -and $envValues['MYSQL_USER']) { $envValues['MYSQL_USER'] } else { 'root' }
$dbPass = if ($envValues.ContainsKey('MYSQL_PASSWORD')) { $envValues['MYSQL_PASSWORD'] } else { '' }
$dbName = if ($envValues.ContainsKey('MYSQL_DATABASE') -and $envValues['MYSQL_DATABASE']) { $envValues['MYSQL_DATABASE'] } else { 'kinaadman' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$dumpFile = Join-Path $backupDir "$dbName.sql"
$uploadsDir = Join-Path $ProjectRoot 'uploads_pdf'
$uploadsZip = Join-Path $backupDir "uploads_pdf-$timestamp.zip"

$dumpArgs = @(
  '-h', $dbHost,
  '-u', $dbUser,
  '--result-file', $dumpFile,
  '--single-transaction',
  '--routines',
  '--triggers',
  '--events',
  '--databases', $dbName
)

if ($dbPass) {
  $dumpArgs = @('-p' + $dbPass) + $dumpArgs
}

& $MysqlDumpPath @dumpArgs

if (Test-Path -LiteralPath $uploadsDir) {
  Compress-Archive -Path (Join-Path $uploadsDir '*') -DestinationPath $uploadsZip -Force
}

Write-Host "Backup created:"
Write-Host "  Database: $dumpFile"
if (Test-Path -LiteralPath $uploadsZip) {
  Write-Host "  Uploads:  $uploadsZip"
}
