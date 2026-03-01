-- ============================================
-- NOTIFICATION DELIVERIES TABLE
-- ============================================
-- 
-- Creates notification_deliveries table for tracking email/push delivery
-- with idempotency support to prevent duplicate sends.
-- 
-- This table tracks delivery attempts for saved_search_matches.
-- ============================================

-- Create notification_deliveries table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.saved_search_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  idempotency_key text NOT NULL UNIQUE,
  error_message text NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_match_id 
  ON public.notification_deliveries(match_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_id 
  ON public.notification_deliveries(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status 
  ON public.notification_deliveries(status) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_idempotency_key 
  ON public.notification_deliveries(idempotency_key);

-- Add updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'notification_deliveries_updated_at'
  ) THEN
    CREATE TRIGGER notification_deliveries_updated_at
      BEFORE UPDATE ON public.notification_deliveries
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- Enable RLS (service role will bypass, but set policies for safety)
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own delivery records (Plus only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_deliveries'
      AND policyname = 'Users can view their own notification deliveries'
  ) THEN
    CREATE POLICY "Users can view their own notification deliveries"
    ON public.notification_deliveries
    FOR SELECT
    TO authenticated
    USING (
      user_id = auth.uid() 
      AND EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() 
        AND p.is_paid = true
      )
    );
  END IF;
END $$;

-- Block all writes for authenticated users (service role only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notification_deliveries'
      AND policyname = 'Block authenticated writes to notification_deliveries'
  ) THEN
    CREATE POLICY "Block authenticated writes to notification_deliveries"
    ON public.notification_deliveries
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);
  END IF;
END $$;

-- Comments
COMMENT ON TABLE public.notification_deliveries IS 'Tracks email/push delivery attempts for saved_search_matches with idempotency';
COMMENT ON COLUMN public.notification_deliveries.idempotency_key IS 'Unique key to prevent duplicate sends: match_id + channel';
COMMENT ON COLUMN public.notification_deliveries.channel IS 'Delivery channel: email or push';
COMMENT ON COLUMN public.notification_deliveries.status IS 'Delivery status: pending, sent, or failed';
