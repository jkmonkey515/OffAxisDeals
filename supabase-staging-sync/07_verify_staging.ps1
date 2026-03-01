# Verify tables exist in Staging
Write-Host "Verifying Staging schema..." -ForegroundColor Cyan

# Get Staging database connection string
$STAGING_DB_URL = Read-Host "Enter Staging database URL (postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres)"

Write-Host "`nChecking for required tables..." -ForegroundColor Yellow

# Check if psql is available
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue

if ($psqlPath) {
    Write-Host "Using psql to query tables..." -ForegroundColor Cyan
    
    # Query to list all public tables
    $query = @"
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;
"@
    
    $query | psql $STAGING_DB_URL -t -A
    
    Write-Host "`nChecking for required tables..." -ForegroundColor Yellow
    
    # Check each required table
    $requiredTables = @("profiles", "listings", "messages", "saved_searches", "saved_search_matches")
    
    foreach ($table in $requiredTables) {
        $checkQuery = "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');"
        $exists = $checkQuery | psql $STAGING_DB_URL -t -A
        
        if ($exists.Trim() -eq "t") {
            Write-Host "✅ $table exists" -ForegroundColor Green
        } else {
            Write-Host "❌ $table NOT found" -ForegroundColor Red
        }
    }
    
    Write-Host "`nChecking RLS status..." -ForegroundColor Yellow
    
    # Check RLS on each table
    foreach ($table in $requiredTables) {
        $rlsQuery = "SELECT relforcerowsecurity FROM pg_class WHERE relname = '$table';"
        $rlsEnabled = $rlsQuery | psql $STAGING_DB_URL -t -A
        
        if ($rlsEnabled.Trim() -eq "t") {
            Write-Host "✅ RLS enabled on $table" -ForegroundColor Green
        } else {
            Write-Host "⚠️  RLS NOT enabled on $table" -ForegroundColor Yellow
        }
    }
    
} else {
    Write-Host "⚠️  psql not found. Install PostgreSQL client tools:" -ForegroundColor Yellow
    Write-Host "https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
    Write-Host "`nOr verify manually in Staging dashboard:" -ForegroundColor Yellow
    Write-Host "1. Go to Table Editor" -ForegroundColor White
    Write-Host "2. Check for: profiles, listings, messages, saved_searches, saved_search_matches" -ForegroundColor White
    Write-Host "3. Go to Authentication > Policies to verify RLS" -ForegroundColor White
}

Write-Host "`n✅ Verification complete!" -ForegroundColor Green

