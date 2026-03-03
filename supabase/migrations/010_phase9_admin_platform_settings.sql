-- Drift Phase 9: admin platform settings + database storage helper

begin;

create table if not exists public.app_settings (
  key text primary key,
  value_text text not null,
  updated_at timestamp with time zone not null default now()
);

insert into public.app_settings (key, value_text)
values ('post_expiry_mode', '15d')
on conflict (key) do nothing;

create index if not exists idx_app_settings_updated_at
  on public.app_settings (updated_at desc);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated, public;
grant all privileges on table public.app_settings to service_role;

create or replace function public.get_database_storage_stats()
returns table(database_bytes bigint)
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database())::bigint as database_bytes;
$$;

revoke all on function public.get_database_storage_stats() from anon, authenticated, public;
grant execute on function public.get_database_storage_stats() to service_role;

commit;
