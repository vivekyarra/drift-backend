-- Drift Phase 7: encrypted password vault copy for admin-only display

begin;

alter table public.users
  add column if not exists password_ciphertext text;

commit;
