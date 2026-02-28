-- Drift Phase 6: username + password auth support

begin;

alter table public.users
  add column if not exists password_hash text;

commit;
