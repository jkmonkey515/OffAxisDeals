# Fix PostgreSQL Tools PATH
Write-Host "Detecting PostgreSQL installation..." -ForegroundColor Cyan

# Common PostgreSQL installation paths
$possiblePaths = @(
    "${env:ProgramFiles}\PostgreSQL\*\bin",
    "${env:ProgramFiles(x86)}\PostgreSQL\*\bin",
    "C:\Program Files\PostgreSQL\*\bin",
    "C:\Program Files (x86)\PostgreSQL\*\bin"
)

$allInstallations = @()

# Find all PostgreSQL installations
foreach ($path in $possiblePaths) {
    $found = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
    foreach ($install in $found) {
        if (Test-Path (Join-Path $install.FullName "pg_dump.exe")) {
            $allInstallations += $install
        }
    }
}

if ($allInstallations.Count -eq 0) {
    Write-Host "`n❌ PostgreSQL bin directory not found!" -ForegroundColor Red
    Write-Host "`nSearched in:" -ForegroundColor Yellow
    foreach ($path in $possiblePaths) {
        Write-Host "  - $path" -ForegroundColor Gray
    }
    Write-Host "`nPlease install PostgreSQL 17 or add the bin directory to your PATH manually." -ForegroundColor Yellow
    exit 1
}

# Sort by version (prefer 17, then 16, then others)
$sortedInstallations = $allInstallations | Sort-Object {
    $folderName = Split-Path (Split-Path $_.FullName -Parent) -Leaf
    if ($folderName -match '(\d+)') {
        $version = [int]$matches[1]
        # Prefer 17, then 16, then others (negative for descending)
        if ($version -eq 17) { return -1000 }
        if ($version -eq 16) { return -500 }
        return -$version
    }
    return 0
}

$pgBinPath = $sortedInstallations[0].FullName
$pgVersion = Split-Path (Split-Path $pgBinPath -Parent) -Leaf

Write-Host "✅ Found PostgreSQL installations:" -ForegroundColor Green
foreach ($install in $sortedInstallations) {
    $v = Split-Path (Split-Path $install.FullName -Parent) -Leaf
    $marker = if ($install.FullName -eq $pgBinPath) { " ← SELECTED" } else { "" }
    Write-Host "  - Version $v : $($install.FullName)$marker" -ForegroundColor Gray
}
Write-Host "`nUsing: $pgBinPath (PostgreSQL $pgVersion)" -ForegroundColor Cyan

# Check if already in PATH
$currentPath = $env:PATH
if ($currentPath -notlike "*$pgBinPath*") {
    Write-Host "`nAdding to PATH for this session..." -ForegroundColor Yellow
    $env:PATH = "$pgBinPath;$env:PATH"
    Write-Host "✅ Added to PATH" -ForegroundColor Green
} else {
    Write-Host "`n✅ Already in PATH" -ForegroundColor Green
}

# Verify tools are accessible
Write-Host "`nVerifying tools..." -ForegroundColor Cyan

try {
    $pgDumpVersion = & pg_dump --version 2>&1
    Write-Host "✅ pg_dump: $pgDumpVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ pg_dump not found!" -ForegroundColor Red
    exit 1
}

try {
    $psqlVersion = & psql --version 2>&1
    Write-Host "✅ psql: $psqlVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ psql not found!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ PostgreSQL tools are ready!" -ForegroundColor Green
Write-Host "Note: PATH change is only for this PowerShell session." -ForegroundColor Gray
Write-Host "Run this script again if you open a new PowerShell window." -ForegroundColor Gray

