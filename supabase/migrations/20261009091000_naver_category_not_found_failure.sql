-- Both persisted failure columns share the existing bounded vocabulary.
-- Replace only their constraints; preserve all previously accepted codes plus CATEGORY_NOT_FOUND and DRAFT_RECOVERY_PENDING.
alter table public.external_action_requests
  drop constraint if exists external_action_requests_failure_code_check;

alter table public.external_action_requests
  add constraint external_action_requests_failure_code_check check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE',
    'CONTENT_MISMATCH', 'MEDIA_DOWNLOAD_FAILED', 'MEDIA_UPLOAD_FAILED', 'DEADLINE_EXPIRED',
    'DEVICE_OFFLINE', 'SUBMIT_PERMIT_REQUIRED', 'CATEGORY_NOT_FOUND', 'DRAFT_RECOVERY_PENDING'
  ));

alter table public.external_action_attempts
  drop constraint if exists external_action_attempts_failure_code_check;

alter table public.external_action_attempts
  add constraint external_action_attempts_failure_code_check check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE',
    'CONTENT_MISMATCH', 'MEDIA_DOWNLOAD_FAILED', 'MEDIA_UPLOAD_FAILED', 'DEADLINE_EXPIRED',
    'DEVICE_OFFLINE', 'SUBMIT_PERMIT_REQUIRED', 'CATEGORY_NOT_FOUND', 'DRAFT_RECOVERY_PENDING'
  ));
