alter table public.media_assets
  add column sha256_digest text
  check (sha256_digest is null or sha256_digest ~ '^[a-f0-9]{64}$');

comment on column public.media_assets.sha256_digest is
  'SHA-256 of the immutable uploaded bytes. Local publishing rejects media without this digest.';
