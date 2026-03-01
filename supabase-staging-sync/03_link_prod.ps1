# Link to Production Project
Write-Host "Linking to Production project..." -ForegroundColor Cyan

# TODO: Replace PROD_PROJECT_REF with your Production project reference ID
$PROD_PROJECT_REF = "lwhxmwvvostzlidmnays"

Write-Host "Using Production project ref: $PROD_PROJECT_REF" -ForegroundColor Yellow

supabase link --project-ref $PROD_PROJECT_REF

Write-Host "`n✅ Linked to Production project!" -ForegroundColor Green

