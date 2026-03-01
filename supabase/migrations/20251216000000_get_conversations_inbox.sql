-- Migration: Create get_conversations_inbox() RPC function
-- Returns enriched conversation data with listing title, participant name, last message, and unread count

-- Create indexes for performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_messages_thread_created_at_desc 
  ON public.messages(thread_id, created_at DESC) 
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread_to_read 
  ON public.messages(thread_id, to_id, read_at) 
  WHERE thread_id IS NOT NULL AND to_id IS NOT NULL;

-- Drop function if exists (for idempotency)
DROP FUNCTION IF EXISTS public.get_conversations_inbox();

-- Create the RPC function
CREATE FUNCTION public.get_conversations_inbox()
RETURNS TABLE (
  id uuid,
  listing_id uuid,
  participant_one uuid,
  participant_two uuid,
  created_at timestamp with time zone,
  listing_title text,
  other_participant_id uuid,
  other_full_name text,
  last_message_body text,
  last_message_created_at timestamp with time zone,
  unread_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- Get current authenticated user ID
  current_user_id := auth.uid();
  
  -- Return early if no user is authenticated
  IF current_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.listing_id,
    c.participant_one,
    c.participant_two,
    c.created_at,
    l.title AS listing_title,
    CASE 
      WHEN c.participant_one = current_user_id THEN c.participant_two
      ELSE c.participant_one
    END AS other_participant_id,
    p.full_name AS other_full_name,
    last_msg.body AS last_message_body,
    last_msg.created_at AS last_message_created_at,
    COALESCE(unread.unread_count, 0)::bigint AS unread_count
  FROM public.conversations c
  -- Only return conversations where current user is a participant
  WHERE (c.participant_one = current_user_id OR c.participant_two = current_user_id)
  -- LEFT JOIN to listings for title
  LEFT JOIN public.listings l ON l.id = c.listing_id
  -- LEFT JOIN LATERAL to get last message per thread
  LEFT JOIN LATERAL (
    SELECT 
      m.body,
      m.created_at
    FROM public.messages m
    WHERE m.thread_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) last_msg ON true
  -- LEFT JOIN to profiles for other participant's full_name
  LEFT JOIN public.profiles p ON p.id = CASE 
    WHEN c.participant_one = current_user_id THEN c.participant_two
    ELSE c.participant_one
  END
  -- LEFT JOIN LATERAL to compute unread count per thread
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS unread_count
    FROM public.messages m
    WHERE m.thread_id = c.id
      AND m.to_id = current_user_id
      AND m.read_at IS NULL
  ) unread ON true
  -- Order by last message time (most recent first), then conversation created_at
  ORDER BY last_msg.created_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_conversations_inbox() TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.get_conversations_inbox() IS 
  'Returns enriched conversation inbox data for the current authenticated user, including listing title, other participant name, last message preview, and unread count. Only returns conversations where the user is a participant.';
