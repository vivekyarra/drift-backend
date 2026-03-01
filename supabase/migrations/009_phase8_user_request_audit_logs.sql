-- Drift Phase 8: per-user request audit logs for admin investigations

begin;

create table if not exists public.user_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id text,
  ip_address text not null,
  method text not null,
  path text not null,
  user_agent text,
  cf_country text,
  cf_region text,
  cf_city text,
  cf_colo text,
  cf_asn bigint,
  cf_ray text,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_user_request_logs_user_created
  on public.user_request_logs (user_id, created_at desc);

create index if not exists idx_user_request_logs_created
  on public.user_request_logs (created_at desc);

create index if not exists idx_user_request_logs_ip
  on public.user_request_logs (ip_address);

alter table public.user_request_logs enable row level security;

revoke all on table public.user_request_logs from anon, authenticated, public;
grant all privileges on table public.user_request_logs to service_role;

commit;
