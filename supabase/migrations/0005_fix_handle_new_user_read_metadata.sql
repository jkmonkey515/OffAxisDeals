-- Fix handle_new_user() to read role/segment from raw_user_meta_data
-- This ensures the trigger uses the role selected during signup

-- Drop existing trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create or replace function that reads from metadata
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
  -- Always insert: id, is_paid, role
  -- Conditionally insert: email, tier, segment
  IF has_email AND has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier, segment)
    VALUES (NEW.id, user_email, false, user_role::text, 'free'::text, user_segment::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email AND has_tier THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier)
    VALUES (NEW.id, user_email, false, user_role::text, 'free'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, segment)
    VALUES (NEW.id, user_email, false, user_role::text, user_segment::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email THEN
    INSERT INTO public.profiles (id, email, is_paid, role)
    VALUES (NEW.id, user_email, false, user_role::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, tier, segment)
    VALUES (NEW.id, false, user_role::text, 'free'::text, user_segment::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_tier THEN
    INSERT INTO public.profiles (id, is_paid, role, tier)
    VALUES (NEW.id, false, user_role::text, 'free'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, segment)
    VALUES (NEW.id, false, user_role::text, user_segment::text)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, is_paid, role)
    VALUES (NEW.id, false, user_role::text)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

