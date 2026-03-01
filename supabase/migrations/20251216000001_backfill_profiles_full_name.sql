-- Backfill profiles.full_name from auth.users metadata
-- For existing users: set full_name from raw_user_meta_data->>'full_name' or email prefix
-- Idempotent: only updates rows where full_name IS NULL or empty string

-- Helper function to extract email prefix (part before @)
-- Returns NULL if email is invalid or empty
CREATE OR REPLACE FUNCTION public.extract_email_prefix(email_address text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF email_address IS NULL OR email_address = '' THEN
    RETURN NULL;
  END IF;
  
  -- Extract part before @ symbol
  RETURN SPLIT_PART(email_address, '@', 1);
END;
$$;

-- Backfill full_name for existing profiles
-- Priority: raw_user_meta_data->>'full_name' > email prefix
-- Only updates where full_name IS NULL or empty
UPDATE public.profiles p
SET full_name = COALESCE(
  NULLIF(TRIM((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p.id)), ''),
  NULLIF(TRIM(public.extract_email_prefix((SELECT email FROM auth.users WHERE id = p.id))), '')
)
WHERE (p.full_name IS NULL OR TRIM(p.full_name) = '')
  AND EXISTS (SELECT 1 FROM auth.users WHERE id = p.id);

-- Update handle_new_user() to set full_name for new users
-- Uses same logic: raw_user_meta_data->>'full_name' or email prefix
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  user_role text;
  user_segment text;
  user_email text;
  user_full_name text;
  has_email boolean;
  has_tier boolean;
  has_segment boolean;
BEGIN
  -- Extract role and segment from raw_user_meta_data
  -- Default to 'investor' if not found (never use 'user' which violates constraint)
  user_role := COALESCE(
    NEW.raw_user_meta_data->>'role',
    'investor'
  );
  
  -- Ensure role is valid (wholesaler, investor, or admin)
  IF user_role NOT IN ('wholesaler', 'investor', 'admin') THEN
    user_role := 'investor';
  END IF;
  
  -- Segment defaults to role value
  user_segment := COALESCE(
    NEW.raw_user_meta_data->>'segment',
    user_role
  );
  
  -- Ensure segment is valid
  IF user_segment NOT IN ('wholesaler', 'investor', 'admin') THEN
    user_segment := user_role;
  END IF;
  
  -- Get email from NEW record
  user_email := NEW.email;
  
  -- Extract full_name: use raw_user_meta_data->>'full_name' or email prefix
  user_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(public.extract_email_prefix(user_email)), '')
  );
  
  -- Check which columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'email'
  ) INTO has_email;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'tier'
  ) INTO has_tier;
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'segment'
  ) INTO has_segment;

  -- Insert with explicit values, conditionally including columns that exist
  -- Always insert: id, is_paid, role, full_name
  -- Conditionally insert: email, tier, segment
  IF has_email AND has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier, segment, full_name)
    VALUES (NEW.id, user_email, false, user_role::text, 'free'::text, user_segment::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_email AND has_tier THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier, full_name)
    VALUES (NEW.id, user_email, false, user_role::text, 'free'::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_email AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, segment, full_name)
    VALUES (NEW.id, user_email, false, user_role::text, user_segment::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_email THEN
    INSERT INTO public.profiles (id, email, is_paid, role, full_name)
    VALUES (NEW.id, user_email, false, user_role::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, tier, segment, full_name)
    VALUES (NEW.id, false, user_role::text, 'free'::text, user_segment::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_tier THEN
    INSERT INTO public.profiles (id, is_paid, role, tier, full_name)
    VALUES (NEW.id, false, user_role::text, 'free'::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSIF has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, segment, full_name)
    VALUES (NEW.id, false, user_role::text, user_segment::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  ELSE
    INSERT INTO public.profiles (id, is_paid, role, full_name)
    VALUES (NEW.id, false, user_role::text, user_full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL OR TRIM(profiles.full_name) = '';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Add comment
COMMENT ON FUNCTION public.extract_email_prefix(text) IS 
  'Extracts the email prefix (part before @) from an email address. Returns NULL if email is invalid or empty.';
