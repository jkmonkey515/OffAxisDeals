# Install Supabase CLI
Write-Host "Installing Supabase CLI..." -ForegroundColor Cyan

npm install -g supabase

Write-Host "`nVerifying installation..." -ForegroundColor Cyan
supabase --version

Write-Host "`n✅ Supabase CLI installed successfully!" -ForegroundColor Green

