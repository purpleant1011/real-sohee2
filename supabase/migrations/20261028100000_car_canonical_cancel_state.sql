-- CAR-05 / ANI-1949: restore the non-terminal cancellation state already used
-- by the canonical queue and terminal-time constraint. No new lifecycle state.
BEGIN;
ALTER TABLE public.conversation_jobs DROP CONSTRAINT conversation_jobs_status_check;
ALTER TABLE public.conversation_jobs ADD CONSTRAINT conversation_jobs_status_check CHECK (
  status IN (
    'queued', 'running', 'cancel_requested', 'planning', 'executing', 'verifying',
    'awaiting_approval', 'succeeded', 'completed', 'needs_attention', 'failed',
    'cancelled', 'partially_completed'
  )
);
COMMIT;
-- Rollback: first reconcile cancel_requested rows; then restore the preceding
-- constraint without cancel_requested. Do not silently convert active jobs.
