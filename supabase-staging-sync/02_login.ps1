# Login to Supabase CLI
Write-Host "Logging in to Supabase..." -ForegroundColor Cyan
Write-Host "This will open your browser for authentication." -ForegroundColor Yellow

supabase login

Write-Host "`n✅ Login successful!" -ForegroundColor Green

