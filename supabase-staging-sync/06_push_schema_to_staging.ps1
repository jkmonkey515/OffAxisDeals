# Apply schema to Staging using psql
Write-Host "Applying schema to Staging..." -ForegroundColor Cyan

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

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

# Verify schema file exists and is not empty
$schemaFile = Join-Path $scriptDir "production-schema.sql"

if (-not (Test-Path $schemaFile)) {
    Write-Host "`n❌ Error: $schemaFile not found!" -ForegroundColor Red
    Write-Host "Run 04_pull_schema_from_prod.ps1 first." -ForegroundColor Yellow
    exit 1
}

$fileInfo = Get-Item $schemaFile
if ($fileInfo.Length -eq 0) {
    Write-Host "`n❌ Error: $schemaFile is empty!" -ForegroundColor Red
    Write-Host "Run 04_pull_schema_from_prod.ps1 again to export the schema." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Schema file found: $schemaFile ($([math]::Round($fileInfo.Length / 1KB, 2)) KB)" -ForegroundColor Green

# Create cleaned schema file (remove public schema creation statements)
Write-Host "`nCleaning schema file (removing public schema statements)..." -ForegroundColor Yellow
$cleanedSchemaFile = Join-Path $scriptDir "staging-schema.sql"

# Remove existing cleaned file if present
if (Test-Path $cleanedSchemaFile) {
    Remove-Item $cleanedSchemaFile -Force
}

# Read and filter out public schema statements
$lines = Get-Content $schemaFile
$cleanedLines = @()
$skippedCount = 0

foreach ($line in $lines) {
    $trimmedLine = $line.Trim()
    
    # Skip lines that create or modify the public schema
    if ($trimmedLine -match "^\s*CREATE\s+SCHEMA\s+public" -or
        $trimmedLine -match "^\s*COMMENT\s+ON\s+SCHEMA\s+public" -or
        $trimmedLine -match "^\s*ALTER\s+SCHEMA\s+public\s+OWNER") {
        $skippedCount++
        continue
    }
    
    $cleanedLines += $line
}

# Write cleaned file as UTF-8 without BOM
try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($cleanedSchemaFile, $cleanedLines, $utf8NoBom)
    
    # Verify file was created and is not empty
    if (-not (Test-Path $cleanedSchemaFile)) {
        Write-Host "`n❌ Error: Failed to create $cleanedSchemaFile!" -ForegroundColor Red
        exit 1
    }
    
    $cleanedFileInfo = Get-Item $cleanedSchemaFile
    if ($cleanedFileInfo.Length -eq 0) {
        Write-Host "`n❌ Error: $cleanedSchemaFile is empty!" -ForegroundColor Red
        Remove-Item $cleanedSchemaFile -Force
        exit 1
    }
    
    Write-Host "✅ Created cleaned schema: $cleanedSchemaFile ($([math]::Round($cleanedFileInfo.Length / 1KB, 2)) KB)" -ForegroundColor Green
    if ($skippedCount -gt 0) {
        Write-Host "   Skipped $skippedCount public schema statement(s)" -ForegroundColor Gray
    }
} catch {
    Write-Host "`n❌ Error writing cleaned schema file: $_" -ForegroundColor Red
    if (Test-Path $cleanedSchemaFile) {
        Remove-Item $cleanedSchemaFile -Force
    }
    exit 1
}

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

# Enable PostGIS extensions before applying schema
Write-Host "`nEnabling PostGIS extensions..." -ForegroundColor Yellow

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

Write-Host "`nApplying schema from $cleanedSchemaFile..." -ForegroundColor Yellow
Write-Host "This may take a minute..." -ForegroundColor Gray

# Run psql with ON_ERROR_STOP=1 to fail on any error
$psqlArgs = @(
    "-v", "ON_ERROR_STOP=1",
    "-f", $cleanedSchemaFile,
    $psqlConnection
)

try {
    & psql $psqlArgs
    
    if ($LASTEXITCODE -ne 0) {
        # Clear password on error
        $env:PGPASSWORD = $null
        $password = $null
        Write-Host "`n❌ psql failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
    Write-Host "`n✅ Schema applied successfully!" -ForegroundColor Green
    
    # Verify tables were created
    Write-Host "`nVerifying tables..." -ForegroundColor Cyan
    
    $verifyQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
    
    # PGPASSWORD still set from above, use it for verification
    $tables = $verifyQuery | psql -t -A $psqlConnection
    
    # Clear password after verification
    $env:PGPASSWORD = $null
    $password = $null
    
    if ($LASTEXITCODE -eq 0 -and $tables) {
        Write-Host "`nPublic tables in Staging:" -ForegroundColor Green
        $tables.Trim() -split "`n" | Where-Object { $_ } | ForEach-Object {
            Write-Host "  - $_" -ForegroundColor Gray
        }
    } else {
        Write-Host "⚠️  Could not verify tables (this is not necessarily an error)" -ForegroundColor Yellow
    }
    
    Write-Host "`n✅ Schema sync complete!" -ForegroundColor Green
    
    # Clean up temporary file
    if (Test-Path $cleanedSchemaFile) {
        Remove-Item $cleanedSchemaFile -Force
        Write-Host "Cleaned up temporary file: $cleanedSchemaFile" -ForegroundColor Gray
    }
    
} catch {
    # Clear password from environment on error
    $env:PGPASSWORD = $null
    $password = $null
    
    # Clean up temporary file on error
    if (Test-Path $cleanedSchemaFile) {
        Remove-Item $cleanedSchemaFile -Force
    }
    
    Write-Host "`n❌ Error during schema apply: $_" -ForegroundColor Red
    exit 1
}

