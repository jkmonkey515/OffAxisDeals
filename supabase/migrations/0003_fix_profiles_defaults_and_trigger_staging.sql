-- Fix profiles table defaults and handle_new_user() function for staging
-- Changes role default from 'user' to 'investor' and ensures all defaults are correct
-- Updates handle_new_user() to explicitly set all values instead of relying on defaults

-- Step 1: Fix role default (change from 'user' to 'investor')
ALTER TABLE public.profiles 
  ALTER COLUMN role SET DEFAULT 'investor'::text;

-- Step 2: Ensure tier default is 'free' (idempotent - safe if already set)
DO $$
BEGIN
  -- Check if tier column exists before altering
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'tier'
  ) THEN
    ALTER TABLE public.profiles ALTER COLUMN tier SET DEFAULT 'free'::text;
  END IF;
END $$;

-- Step 3: Ensure is_paid default is false (idempotent - safe if already set)
ALTER TABLE public.profiles 
  ALTER COLUMN is_paid SET DEFAULT false;

-- Step 4: Set segment default to 'investor' if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'segment'
  ) THEN
    ALTER TABLE public.profiles ALTER COLUMN segment SET DEFAULT 'investor'::text;
  END IF;
END $$;

-- Step 5: Update handle_new_user() to explicitly set all values
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_email boolean;
  has_tier boolean;
  has_segment boolean;
BEGIN
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
  IF has_email AND has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier, segment)
    VALUES (NEW.id, NEW.email, false, 'investor'::text, 'free'::text, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email AND has_tier THEN
    INSERT INTO public.profiles (id, email, is_paid, role, tier)
    VALUES (NEW.id, NEW.email, false, 'investor'::text, 'free'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email AND has_segment THEN
    INSERT INTO public.profiles (id, email, is_paid, role, segment)
    VALUES (NEW.id, NEW.email, false, 'investor'::text, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_email THEN
    INSERT INTO public.profiles (id, email, is_paid, role)
    VALUES (NEW.id, NEW.email, false, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_tier AND has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, tier, segment)
    VALUES (NEW.id, false, 'investor'::text, 'free'::text, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_tier THEN
    INSERT INTO public.profiles (id, is_paid, role, tier)
    VALUES (NEW.id, false, 'investor'::text, 'free'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSIF has_segment THEN
    INSERT INTO public.profiles (id, is_paid, role, segment)
    VALUES (NEW.id, false, 'investor'::text, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, is_paid, role)
    VALUES (NEW.id, false, 'investor'::text)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 6: Ensure trigger exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

