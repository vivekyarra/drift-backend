-- Drift Phase 10: optional reason field for content reports

begin;

alter table public.reports
  add column if not exists reason text;

commit;
