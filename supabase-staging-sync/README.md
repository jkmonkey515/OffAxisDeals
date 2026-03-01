# Supabase Production to Staging Schema Sync

Step-by-step instructions to copy Production database schema and RLS policies to Staging.

## Prerequisites: Install PostgreSQL Client Tools

You need `pg_dump` and `psql` in your PATH. Choose one method:

### Option 1: Winget (Recommended)

First, search for available packages:
```powershell
winget search postgresql
```

Try these package IDs in order:
```powershell
winget install PostgreSQL.PostgreSQL
# OR if that fails:
winget install postgresql
# OR if that fails:
winget install PostgresPro.PostgreSQL
```

### Option 2: Chocolatey

**Install Chocolatey (if missing):**
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

**Install PostgreSQL:**
```powershell
choco install postgresql
```

### Option 3: Direct Installer

1. **Download:** https://www.postgresql.org/download/windows/
2. **Select:** "Download the installer" → **PostgreSQL 17.x** (required for Supabase server compatibility)
3. **During install:**
   - Check "Command Line Tools" (includes pg_dump and psql)
   - Add to PATH: Check "Add PostgreSQL bin directory to PATH"
4. **Restart PowerShell** after installation

**Note:** Install PostgreSQL 17 to match Supabase server version. Version 16 will cause compatibility errors.

### Verify Installation

```powershell
pg_dump --version
psql --version
```

Both should show version numbers. If not, run:
```powershell
.\00_fix_pg_tools_path.ps1
```

This script will detect PostgreSQL installation and add it to PATH for the current session.

## Quick Start

Run scripts in order:
```powershell
.\00_fix_pg_tools_path.ps1  # Run this first if pg_dump/psql not found
.\01_install_cli.ps1
.\02_login.ps1
.\03_link_prod.ps1
.\04_pull_schema_from_prod.ps1
.\05_link_staging.ps1
.\07_reset_staging_db.ps1   # Reset staging before applying schema
.\06_push_schema_to_staging.ps1
```

## Manual Steps

### Step 1: Install Supabase CLI
```powershell
npm install -g supabase
```

### Step 2: Login to Supabase
```powershell
supabase login
```

### Step 3: Link to Production Project
```powershell
supabase link --project-ref PROD_PROJECT_REF
```

### Step 4: Export Schema from Production

**If pg_dump/psql not found, run first:**
```powershell
.\00_fix_pg_tools_path.ps1
```

**Get Production database URL:**
1. Go to: https://app.supabase.com/project/lwhxmwvvostzlidmnays/settings/database
2. Copy "Connection string" → "URI" format

**Run export:**
```powershell
.\04_pull_schema_from_prod.ps1
```

This creates `production-schema.sql` with tables, functions, triggers, and RLS policies.

### Step 5: Link to Staging Project
```powershell
supabase link --project-ref STAGING_PROJECT_REF
```

### Step 6: Reset Staging Database (if needed)

**If you're getting duplicate object errors, reset staging first:**

**Get Staging database connection details:**
1. Go to: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/settings/database
2. Get connection details (host, port, database, username, password)

**Run reset:**
```powershell
.\07_reset_staging_db.ps1
```

⚠️ **WARNING:** This will DROP and recreate the public schema, deleting all tables, functions, and data.

The script will:
- Prompt for Staging connection details
- Drop and recreate the public schema
- Restore proper permissions
- Re-enable PostGIS extensions

### Step 7: Apply Schema to Staging

**Get Staging database connection details:**
1. Go to: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/settings/database
2. Get connection details (host, port, database, username, password)

**Run apply:**
```powershell
.\06_push_schema_to_staging.ps1
```

The script will:
- Verify `production-schema.sql` exists and is non-empty
- Prompt for Staging connection details
- Enable PostGIS extensions
- Apply schema using `psql` with error handling
- List all public tables after applying

**Optional additional verification:**
```powershell
.\07_verify_staging.ps1
```

## Verification Checklist

After syncing, verify in Staging dashboard:

### Tables
- [ ] `profiles` table exists
- [ ] `listings` table exists
- [ ] `messages` table exists
- [ ] `saved_searches` table exists
- [ ] `saved_search_matches` table exists

### RLS Policies
- [ ] RLS enabled on `profiles`
- [ ] RLS enabled on `listings`
- [ ] RLS enabled on `messages`
- [ ] RLS enabled on `saved_searches`
- [ ] RLS enabled on `saved_search_matches`

### Storage Buckets
Create these buckets in Staging Storage:
- [ ] `listing-images` (public, for listing photos)
- [ ] `profile-images` (public, for user avatars)

## Notes

- **Requires PostgreSQL client tools** (`pg_dump` and `psql`)
- Schema only (no data is copied)
- RLS policies are included in the schema export
- Always review `production-schema.sql` before applying to staging
- Scripts will fail with non-zero exit codes if errors occur
