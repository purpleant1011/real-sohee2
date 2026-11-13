-- Migration: 20260911090000_ani1327_reconcile_booking_id_type.sql
-- Issue: ANI-1327 / REM-02
-- Description: Reconcile booking_id and customer_id data types to TEXT across marketing_missions and customer_conversations
--              to maintain type parity with reservations.id (bk_UUID) and customer identifiers without 42883 join errors.

ALTER TABLE public.marketing_missions 
  ALTER COLUMN booking_id TYPE text USING booking_id::text,
  ALTER COLUMN customer_id TYPE text USING customer_id::text;

ALTER TABLE public.customer_conversations 
  ALTER COLUMN booking_id TYPE text USING booking_id::text;

CREATE INDEX IF NOT EXISTS idx_marketing_missions_booking_id ON public.marketing_missions(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_missions_customer_id ON public.marketing_missions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_conversations_booking_id ON public.customer_conversations(booking_id) WHERE booking_id IS NOT NULL;
