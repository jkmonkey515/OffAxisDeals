# Link to Staging Project
Write-Host "Linking to Staging project..." -ForegroundColor Cyan

# TODO: Replace STAGING_PROJECT_REF with your Staging project reference ID
$STAGING_PROJECT_REF = "tnfnxuhridfqxnwjojgq"

Write-Host "Using Staging project ref: $STAGING_PROJECT_REF" -ForegroundColor Yellow

supabase link --project-ref $STAGING_PROJECT_REF

Write-Host "`n✅ Linked to Staging project!" -ForegroundColor Green

