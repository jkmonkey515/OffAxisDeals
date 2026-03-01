# Reset Staging Database
Write-Host "Resetting Staging database..." -ForegroundColor Cyan
Write-Host "⚠️  WARNING: This will DROP and recreate the public schema!" -ForegroundColor Yellow
Write-Host "All tables, functions, and data in the public schema will be deleted." -ForegroundColor Yellow

# Check for psql
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue

if (-not $psqlPath) {
    Write-Host "`n❌ psql not found!" -ForegroundColor Red
    Write-Host "`nInstall PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "1. Download: https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
    Write-Host "2. Or use chocolatey: choco install postgresql" -ForegroundColor Cyan
    Write-Host "3. Or use winget: winget install PostgreSQL.PostgreSQL" -ForegroundColor Cyan
    Write-Host "`nAfter installation, restart PowerShell and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ psql found at: $($psqlPath.Source)" -ForegroundColor Green

# Get Staging database connection details
Write-Host "`nEnter Staging database connection details:" -ForegroundColor Yellow
Write-Host "Get these from: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/settings/database" -ForegroundColor Cyan

$STAGING_REF = "tnfnxuhridfqxnwjojgq"
$defaultHost = "db.$STAGING_REF.supabase.co"
$defaultPort = "5432"
$defaultDatabase = "postgres"
$defaultUsername = "postgres"

# Prompt for host with validation
do {
    Write-Host "`nHost (e.g., db.$STAGING_REF.supabase.co) - NOT a full URL:" -ForegroundColor Yellow
    $dbHost = Read-Host "Host [$defaultHost]"
    
    if ([string]::IsNullOrWhiteSpace($dbHost)) {
        $dbHost = $defaultHost
    }
    
    # Validate: catch if user pasted full connection string
    if ($dbHost -like "postgres*" -or $dbHost -like "*://*" -or $dbHost.Contains("@")) {
        Write-Host "❌ Error: Please enter ONLY the hostname (e.g., db.$STAGING_REF.supabase.co)" -ForegroundColor Red
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

# Set PGPASSWORD environment variable (password won't appear in logs)
$env:PGPASSWORD = $password

# Build psql connection string
$psqlConnection = "postgresql://$username@$dbHost`:$port/$database"

# Reset SQL commands
Write-Host "`nResetting public schema..." -ForegroundColor Yellow

$resetCommands = @(
    "DROP SCHEMA public CASCADE;",
    "CREATE SCHEMA public;",
    "GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;"
)

$resetScript = $resetCommands -join "`n"

try {
    $resetScript | psql -v ON_ERROR_STOP=1 $psqlConnection
    
    if ($LASTEXITCODE -ne 0) {
        # Clear password on error
        $env:PGPASSWORD = $null
        $password = $null
        Write-Host "`n❌ Failed to reset schema (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "✅ Public schema reset successfully" -ForegroundColor Green
} catch {
    # Clear password from environment on error
    $env:PGPASSWORD = $null
    $password = $null
    Write-Host "`n❌ Error resetting schema: $_" -ForegroundColor Red
    exit 1
}

# Re-enable PostGIS extensions
Write-Host "`nRe-enabling PostGIS extensions..." -ForegroundColor Yellow

$extensionCommands = @(
    "CREATE EXTENSION IF NOT EXISTS postgis;",
    "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
)

$extensionScript = $extensionCommands -join "`n"

try {
    $extensionScript | psql -v ON_ERROR_STOP=1 $psqlConnection
    
    if ($LASTEXITCODE -ne 0) {
        # Clear password on error
        $env:PGPASSWORD = $null
        $password = $null
        Write-Host "`n❌ Failed to enable PostGIS extensions (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "✅ PostGIS extensions enabled" -ForegroundColor Green
} catch {
    # Clear password from environment on error
    $env:PGPASSWORD = $null
    $password = $null
    Write-Host "`n❌ Error enabling PostGIS extensions: $_" -ForegroundColor Red
    exit 1
}

# Clear password after successful reset
$env:PGPASSWORD = $null
$password = $null

Write-Host "`n✅ Staging database reset complete!" -ForegroundColor Green
Write-Host "You can now run 06_push_schema_to_staging.ps1 to apply the schema." -ForegroundColor Cyan

