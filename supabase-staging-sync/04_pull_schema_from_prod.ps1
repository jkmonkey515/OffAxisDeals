# Export schema from Production using pg_dump
Write-Host "Exporting schema from Production..." -ForegroundColor Cyan

# Check for pg_dump
$pgDumpPath = Get-Command pg_dump -ErrorAction SilentlyContinue

if (-not $pgDumpPath) {
    Write-Host "`n❌ pg_dump not found!" -ForegroundColor Red
    Write-Host "`nInstall PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "1. Download: https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
    Write-Host "2. Or use chocolatey: choco install postgresql" -ForegroundColor Cyan
    Write-Host "3. Or use winget: winget install PostgreSQL.PostgreSQL" -ForegroundColor Cyan
    Write-Host "`nAfter installation, restart PowerShell and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ pg_dump found at: $($pgDumpPath.Source)" -ForegroundColor Green

# Get Production database connection details
Write-Host "`nEnter Production database connection details:" -ForegroundColor Yellow
Write-Host "Get these from: https://app.supabase.com/project/lwhxmwvvostzlidmnays/settings/database" -ForegroundColor Cyan

$PROD_REF = "lwhxmwvvostzlidmnays"
$defaultHost = "db.$PROD_REF.supabase.co"
$defaultPort = "5432"
$defaultDatabase = "postgres"
$defaultUsername = "postgres"

# Prompt for host with validation
do {
    Write-Host "`nHost (e.g., db.$PROD_REF.supabase.co) - NOT a full URL:" -ForegroundColor Yellow
    $dbHost = Read-Host "Host [$defaultHost]"
    
    if ([string]::IsNullOrWhiteSpace($dbHost)) {
        $dbHost = $defaultHost
    }
    
    # Validate: catch if user pasted full connection string
    if ($dbHost -like "postgres*" -or $dbHost -like "*://*" -or $dbHost.Contains("@")) {
        Write-Host "❌ Error: Please enter ONLY the hostname (e.g., db.$PROD_REF.supabase.co)" -ForegroundColor Red
        Write-Host "Do NOT paste the full connection string here." -ForegroundColor Yellow
        $dbHost = $null
    }
} while ([string]::IsNullOrWhiteSpace($dbHost))

Write-Host "Port (default: 5432):" -ForegroundColor Yellow
$port = Read-Host "Port [$defaultPort]"
if ([string]::IsNullOrWhiteSpace($port)) {
    $port = $defaultPort
}

Write-Host "Database (default: postgres):" -ForegroundColor Yellow
$database = Read-Host "Database [$defaultDatabase]"
if ([string]::IsNullOrWhiteSpace($database)) {
    $database = $defaultDatabase
}

Write-Host "Username (default: postgres):" -ForegroundColor Yellow
$username = Read-Host "Username [$defaultUsername]"
if ([string]::IsNullOrWhiteSpace($username)) {
    $username = $defaultUsername
}

Write-Host "`nEnter password (input will be hidden):" -ForegroundColor Yellow
$securePassword = Read-Host -AsSecureString

# Convert secure string to plain text (in memory only)
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

if ([string]::IsNullOrWhiteSpace($password)) {
    Write-Host "`n❌ Error: Password cannot be empty!" -ForegroundColor Red
    exit 1
}

$outputFile = "production-schema.sql"

# Remove existing file if present
if (Test-Path $outputFile) {
    Write-Host "Removing existing $outputFile..." -ForegroundColor Yellow
    Remove-Item $outputFile -Force
}

Write-Host "`nExporting schema (tables, functions, triggers, RLS policies)..." -ForegroundColor Yellow
Write-Host "This may take a minute..." -ForegroundColor Gray

# Set PGPASSWORD environment variable (password won't appear in logs)
$env:PGPASSWORD = $password

# Export schema only (no data) with all objects
# --schema-only: schema only, no data
# --schema=public: only public schema
# --no-owner: don't include ownership commands
# --no-privileges: don't include privilege commands
# RLS policies, functions, and triggers are included by default
$pgDumpArgs = @(
    "--schema-only",
    "--schema=public",
    "--no-owner",
    "--no-privileges",
    "--host=$dbHost",
    "--port=$port",
    "--dbname=$database",
    "--username=$username",
    "--file=$outputFile"
)

try {
    & pg_dump $pgDumpArgs
    
    # Clear password from environment immediately after use
    $env:PGPASSWORD = $null
    $password = $null
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ pg_dump failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        if (Test-Path $outputFile) {
            Remove-Item $outputFile -Force
        }
        exit $LASTEXITCODE
    }
    
    # Verify file was created and is not empty
    if (-not (Test-Path $outputFile)) {
        Write-Host "`n❌ Error: Schema file was not created!" -ForegroundColor Red
        exit 1
    }
    
    $fileInfo = Get-Item $outputFile
    if ($fileInfo.Length -eq 0) {
        Write-Host "`n❌ Error: Schema file is empty!" -ForegroundColor Red
        Remove-Item $outputFile -Force
        exit 1
    }
    
    Write-Host "`n✅ Schema exported successfully!" -ForegroundColor Green
    Write-Host "File: $outputFile ($([math]::Round($fileInfo.Length / 1KB, 2)) KB)" -ForegroundColor Cyan
    Write-Host "`nReview production-schema.sql before proceeding." -ForegroundColor Yellow
    
} catch {
    # Clear password from environment on error
    $env:PGPASSWORD = $null
    $password = $null
    
    Write-Host "`n❌ Error during export: $_" -ForegroundColor Red
    if (Test-Path $outputFile) {
        Remove-Item $outputFile -Force
    }
    exit 1
}

