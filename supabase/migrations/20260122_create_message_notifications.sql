-- Migration: Create notifications for new messages with proper ref_id
-- Creates a trigger that inserts/updates notification rows when messages are inserted
-- Sets ref_id = 'conversation:<conversation_id>' for proper deep-linking
-- Uses UPSERT to keep ONE notification per conversation (updates existing row on new messages)
-- Backfills existing lead_message notifications to include property context in title
-- Idempotent: safe to run multiple times
-- 
-- PRODUCTION SCHEMA:
-- - messages: thread_id, from_id, to_id, body, created_at
-- - conversations: id, listing_id, participant_one, participant_two, created_by
-- - listings: id, title, address, city, state, zip
-- - notifications has unique partial index: notifications_user_ref_id_unique ON (user_id, ref_id) WHERE ref_id IS NOT NULL

-- ============================================
-- FUNCTION: Create/update notification for new message
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  v_conversation_id uuid;
  v_recipient_id uuid;
  v_sender_id uuid;
  v_listing_id uuid;
  v_participant_one uuid;
  v_participant_two uuid;
  v_listing_title text;
  v_listing_address text;
  v_listing_city text;
  v_listing_state text;
  v_listing_zip text;
  v_listing_context text;
  v_notification_title text;
  v_notification_body text;
BEGIN
  -- Get conversation details using thread_id
  SELECT 
    c.id,
    c.listing_id,
    c.participant_one,
    c.participant_two
  INTO 
    v_conversation_id,
    v_listing_id,
    v_participant_one,
    v_participant_two
  FROM public.conversations c
  WHERE c.id = NEW.thread_id;

  -- If conversation not found, skip notification
  IF v_conversation_id IS NULL THEN
    RAISE NOTICE 'notify_new_message: Skipping notification - conversation not found for thread_id=%', NEW.thread_id;
    RETURN NEW;
  END IF;

  -- Determine recipient EXACTLY:
  -- IF NEW.from_id = participant_one THEN recipient = participant_two
  -- ELSE IF NEW.from_id = participant_two THEN recipient = participant_one
  -- ELSE skip (sender is not a participant)
  IF NEW.from_id = v_participant_one THEN
    v_recipient_id := v_participant_two;
  ELSIF NEW.from_id = v_participant_two THEN
    v_recipient_id := v_participant_one;
  ELSE
    RAISE NOTICE 'notify_new_message: Skipping notification - sender_id=% is not a participant (participant_one=%, participant_two=%)', NEW.from_id, v_participant_one, v_participant_two;
    RETURN NEW;
  END IF;

  -- If recipient is NULL, skip notification
  IF v_recipient_id IS NULL THEN
    RAISE NOTICE 'notify_new_message: Skipping notification - recipient_id is NULL (sender_id=%, participant_one=%, participant_two=%)', NEW.from_id, v_participant_one, v_participant_two;
    RETURN NEW;
  END IF;

  -- Get listing details for notification title context
  IF v_listing_id IS NOT NULL THEN
    SELECT 
      l.title,
      l.address,
      l.city,
      l.state,
      l.zip
    INTO 
      v_listing_title,
      v_listing_address,
      v_listing_city,
      v_listing_state,
      v_listing_zip
    FROM public.listings l
    WHERE l.id = v_listing_id;
  END IF;

  -- Build listing context: prefer title, else formatted address
  IF v_listing_title IS NOT NULL AND v_listing_title != '' THEN
    v_listing_context := v_listing_title;
  ELSE
    -- Build formatted address: "<address>, <city>, <state> <zip>" (only non-empty pieces)
    v_listing_context := '';
    
    IF v_listing_address IS NOT NULL AND v_listing_address != '' THEN
      v_listing_context := v_listing_address;
    END IF;
    
    IF v_listing_city IS NOT NULL AND v_listing_city != '' THEN
      IF v_listing_context != '' THEN
        v_listing_context := v_listing_context || ', ';
      END IF;
      v_listing_context := v_listing_context || v_listing_city;
    END IF;
    
    IF v_listing_state IS NOT NULL AND v_listing_state != '' THEN
      IF v_listing_context != '' THEN
        v_listing_context := v_listing_context || ', ';
      END IF;
      v_listing_context := v_listing_context || v_listing_state;
    END IF;
    
    IF v_listing_zip IS NOT NULL AND v_listing_zip != '' THEN
      IF v_listing_context != '' THEN
        -- Add space before zip if we have previous parts, otherwise just zip
        IF v_listing_state IS NOT NULL AND v_listing_state != '' THEN
          v_listing_context := v_listing_context || ' ';
        ELSE
          v_listing_context := v_listing_context || ', ';
        END IF;
      END IF;
      v_listing_context := v_listing_context || v_listing_zip;
    END IF;
  END IF;

  -- Build notification title with property context (NO EXCEPTIONS)
  -- Title MUST start with 'New message about ' and include context
  IF v_listing_context IS NOT NULL AND v_listing_context != '' THEN
    v_notification_title := 'New message about ' || v_listing_context;
  ELSE
    -- Fallback if context is empty (shouldn't happen, but be safe)
    v_notification_title := 'New message about a listing';
  END IF;

  -- Build notification body (message preview)
  v_notification_body := COALESCE(
    LEFT(NEW.body, 120),
    'New message'
  );
  -- Truncate body if too long and add ellipsis
  IF LENGTH(v_notification_body) = 120 THEN
    v_notification_body := v_notification_body || '...';
  END IF;

  -- UPSERT notification for the recipient
  -- ON CONFLICT matches the partial unique index: (user_id, ref_id) WHERE ref_id IS NOT NULL
  -- This ensures ONE notification per conversation (updates existing row on new messages)
  BEGIN
    INSERT INTO public.notifications (
      user_id,
      type,
      ref_id,
      title,
      body,
      listing_id,
      is_read,
      read_at,
      created_at
    ) VALUES (
      v_recipient_id,  -- CRITICAL: This must be the recipient, NOT NEW.from_id
      'lead_message',
      'conversation:' || v_conversation_id::text,
      v_notification_title,
      v_notification_body,
      v_listing_id,
      false,
      NULL,
      NOW()
    )
    ON CONFLICT (user_id, ref_id) WHERE ref_id IS NOT NULL DO UPDATE
    SET
      is_read = false,
      read_at = NULL,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      listing_id = EXCLUDED.listing_id,
      created_at = NOW();  -- Update created_at so notification reorders to newest
    
    RAISE NOTICE 'notify_new_message: UPSERT notification for recipient_id=%, sender_id=%, ref_id=conversation:%, title=%', v_recipient_id, NEW.from_id, v_conversation_id, v_notification_title;
  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error but don't fail the message insert
      RAISE NOTICE 'notify_new_message: Failed to UPSERT notification - SQLERRM: %', SQLERRM;
      RAISE NOTICE 'notify_new_message: recipient_id=%, sender_id=%, ref_id=conversation:%, listing_id=%', v_recipient_id, NEW.from_id, v_conversation_id, v_listing_id;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGER: Create/update notification on message insert
-- ============================================

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_notify_new_message ON public.messages;
CREATE TRIGGER trigger_notify_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_message();

-- ============================================
-- BACKFILL: Update existing lead_message notifications to include property context
-- ============================================

-- Update existing lead_message notifications that have title = 'New message' or NULL/empty
-- Compute the same context logic and update title to 'New message about <context>'
-- Safe to re-run (idempotent)
-- 
-- Uses a helper function to build the formatted address string consistently
DO $$
DECLARE
  v_notification_record RECORD;
  v_listing_title text;
  v_listing_address text;
  v_listing_city text;
  v_listing_state text;
  v_listing_zip text;
  v_listing_context text;
  v_notification_title text;
BEGIN
  FOR v_notification_record IN
    SELECT n.id, n.listing_id
    FROM public.notifications n
    WHERE n.type = 'lead_message'
      AND (
        n.title IS NULL 
        OR n.title = '' 
        OR n.title = 'New message'
      )
  LOOP
    -- Get listing details
    IF v_notification_record.listing_id IS NOT NULL THEN
      SELECT 
        l.title,
        l.address,
        l.city,
        l.state,
        l.zip
      INTO 
        v_listing_title,
        v_listing_address,
        v_listing_city,
        v_listing_state,
        v_listing_zip
      FROM public.listings l
      WHERE l.id = v_notification_record.listing_id;
    END IF;

    -- Build listing context: prefer title, else formatted address
    IF v_listing_title IS NOT NULL AND v_listing_title != '' THEN
      v_listing_context := v_listing_title;
    ELSE
      -- Build formatted address: "<address>, <city>, <state> <zip>" (only non-empty pieces)
      v_listing_context := '';
      
      IF v_listing_address IS NOT NULL AND v_listing_address != '' THEN
        v_listing_context := v_listing_address;
      END IF;
      
      IF v_listing_city IS NOT NULL AND v_listing_city != '' THEN
        IF v_listing_context != '' THEN
          v_listing_context := v_listing_context || ', ';
        END IF;
        v_listing_context := v_listing_context || v_listing_city;
      END IF;
      
      IF v_listing_state IS NOT NULL AND v_listing_state != '' THEN
        IF v_listing_context != '' THEN
          v_listing_context := v_listing_context || ', ';
        END IF;
        v_listing_context := v_listing_context || v_listing_state;
      END IF;
      
      IF v_listing_zip IS NOT NULL AND v_listing_zip != '' THEN
        IF v_listing_context != '' THEN
          -- Add space before zip if we have previous parts, otherwise just zip
          IF v_listing_state IS NOT NULL AND v_listing_state != '' THEN
            v_listing_context := v_listing_context || ' ';
          ELSE
            v_listing_context := v_listing_context || ', ';
          END IF;
        END IF;
        v_listing_context := v_listing_context || v_listing_zip;
      END IF;
    END IF;

    -- Build notification title
    IF v_listing_context IS NOT NULL AND v_listing_context != '' THEN
      v_notification_title := 'New message about ' || v_listing_context;
    ELSE
      v_notification_title := 'New message about a listing';
    END IF;

    -- Update the notification
    UPDATE public.notifications
    SET title = v_notification_title
    WHERE id = v_notification_record.id;
  END LOOP;
END $$;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION public.notify_new_message() IS 'Creates or updates a notification for the recipient (other participant) when a new message is inserted. Uses UPSERT to keep ONE notification per conversation. Sets ref_id = conversation:<id> for deep-linking. Title ALWAYS includes property context (listing title or formatted address). Uses production schema: thread_id, from_id, participant_one/participant_two. CRITICAL: user_id must be recipient, NOT sender.';
COMMENT ON TRIGGER trigger_notify_new_message ON public.messages IS 'Automatically creates or updates notifications when messages are inserted. Uses UPSERT to maintain one notification per conversation.';

-- ============================================
-- VERIFICATION SQL (for testing - not executed)
-- ============================================
-- 
-- 1. Verify trigger exists:
-- SELECT tgname, tgrelid::regclass 
-- FROM pg_trigger 
-- WHERE tgname = 'trigger_notify_new_message';
--
-- 2. Send first message in a conversation, then verify notification created:
-- SELECT id, user_id, type, ref_id, title, is_read, read_at, created_at
-- FROM notifications 
-- WHERE ref_id = 'conversation:<conversation_id>'
-- ORDER BY created_at DESC;
-- Expected: One row with type='lead_message', is_read=false, title starts with 'New message about '
--
-- 3. Mark notification as read:
-- UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = '<notification_id>';
--
-- 4. Send second message in same conversation, then verify SAME row updated:
-- SELECT id, user_id, type, ref_id, title, is_read, read_at, created_at
-- FROM notifications 
-- WHERE ref_id = 'conversation:<conversation_id>'
-- ORDER BY created_at DESC;
-- Expected: Same id as step 2, but created_at is newer, is_read=false, read_at=NULL, title updated
--
-- 5. Verify backfill worked (existing rows updated):
-- SELECT id, title, listing_id
-- FROM notifications 
-- WHERE type = 'lead_message' 
--   AND (title IS NULL OR title = '' OR title = 'New message');
-- Expected: 0 rows (all should have been updated to 'New message about ...')
--
-- 6. Verify exactly one notification per conversation:
-- SELECT ref_id, COUNT(*) as count
-- FROM notifications 
-- WHERE type = 'lead_message' 
--   AND ref_id LIKE 'conversation:%'
-- GROUP BY ref_id
-- HAVING COUNT(*) > 1;
-- Expected: 0 rows (each conversation should have exactly one notification)
