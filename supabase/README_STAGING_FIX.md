# Apply Migrations to Staging

These migrations fix staging database issues.

## Migration 1: Add is_paid Column

Adds the `is_paid` column to the `profiles` table.

### Steps

1. **Get staging database connection details:**
   - Go to: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/settings/database
   - Note: host, port, database, username, password

2. **From repo root, run psql:**
   ```powershell
   cd C:\Projects\OffAxisDealsMobile
   $env:PGPASSWORD = "your-staging-password"
   psql -h db.tnfnxuhridfqxnwjojgq.supabase.co -p 5432 -U postgres -d postgres -f supabase/migrations/0001_add_is_paid_to_profiles.sql
   ```

3. **Verify in Supabase Table Editor:**
   - Open: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/editor
   - Navigate to `profiles` table
   - Confirm `is_paid` column exists (boolean, default false)

## Migration 2: Fix handle_new_user() Function

Fixes the `handle_new_user()` function to not reference the `email` column (which doesn't exist in staging).

### Steps

1. **Apply the migration:**
   ```powershell
   cd C:\Projects\OffAxisDealsMobile
   $env:PGPASSWORD = "your-staging-password"
   psql -h db.tnfnxuhridfqxnwjojgq.supabase.co -p 5432 -U postgres -d postgres -f supabase/migrations/0002_fix_handle_new_user_staging.sql
   ```

2. **Verify the function:**
   - Open: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/editor
   - Navigate to Database → Functions
   - Confirm `handle_new_user()` exists and doesn't reference `email`

3. **Test signup:**
   - Sign up a new user in the app
   - Run verification query (see `0002_verify_handle_new_user.sql`)
   - Confirm profile row was created with `id` and `is_paid = false`

## Migration 3: Fix Profiles Defaults and Trigger

Fixes the `profiles.role` default from 'user' to 'investor' and updates `handle_new_user()` to explicitly set all values.

### Steps

1. **Apply the migration:**
   ```powershell
   cd C:\Projects\OffAxisDealsMobile
   $env:PGPASSWORD = "your-staging-password"
   psql -h db.tnfnxuhridfqxnwjojgq.supabase.co -p 5432 -U postgres -d postgres -f supabase/migrations/0003_fix_profiles_defaults_and_trigger_staging.sql
   ```

2. **Verify column defaults:**
   - Open: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/editor
   - Navigate to SQL Editor
   - Run verification queries from `0003_verify_profiles_defaults.sql`
   - Confirm:
     - `role` default is 'investor'
     - `tier` default is 'free' (if column exists)
     - `is_paid` default is false
     - `segment` default is 'investor' (if column exists)

3. **Verify trigger:**
   - Run the trigger verification query from `0003_verify_profiles_defaults.sql`
   - Confirm `on_auth_user_created` trigger exists on `auth.users`

4. **Test signup:**
   - Sign up a new user in the app
   - Run the profile verification query from `0003_verify_profiles_defaults.sql`
   - Confirm profile row was created with:
     - `role = 'investor'`
     - `tier = 'free'` (if column exists)
     - `is_paid = false`
     - `segment = 'investor'` (if column exists)

## Migration 6: Restrict Profiles RLS and Create profile_cards View

Restricts profiles table RLS to only allow users to view their own profile, and creates a public-facing `profile_cards` view.

### Steps

1. **Apply the migration:**
   ```powershell
   cd C:\Projects\OffAxisDealsMobile
   $env:PGPASSWORD = "your-staging-password"
   psql -h db.tnfnxuhridfqxnwjojgq.supabase.co -p 5432 -U postgres -d postgres -f supabase/migrations/0006_restrict_profiles_rls_and_create_view.sql
   ```

2. **Verify RLS policies:**
   - Open: https://app.supabase.com/project/tnfnxuhridfqxnwjojgq/editor
   - Navigate to SQL Editor
   - Run verification queries from `0006_verify_profiles_rls_and_view.sql`
   - Confirm:
     - Only one SELECT policy on `profiles` (own-profile only)
     - `profile_cards` view exists with limited columns
     - One SELECT policy on `profile_cards` (allows viewing all cards)

3. **Test access:**
   - As an authenticated user, run: `SELECT * FROM public.profiles;`
   - Expected: Only returns your own row
   - As an authenticated user, run: `SELECT * FROM public.profile_cards LIMIT 10;`
   - Expected: Returns up to 10 rows from any user

