-- Add is_paid column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

-- Optional: Add comment explaining the column
COMMENT ON COLUMN public.profiles.is_paid IS 'Derived from Stripe subscription status; managed server-side.';

-- Optional: Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

