-- Drift Phase 1 foundation schema
-- Run this in Supabase SQL Editor (or migration pipeline) against your project.

begin;

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  trust_score integer not null default 0,
  recovery_key_hash text not null,
  created_at timestamp with time zone not null default now(),
  constraint users_username_len check (char_length(username) between 3 and 20)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  device_hash text,
  created_at timestamp with time zone not null default now(),
  last_active timestamp with time zone not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  trust_weight integer not null default 1,
  report_count integer not null default 0,
  hidden boolean not null default false,
  constraint posts_content_len check (char_length(content) <= 500),
  constraint posts_content_non_empty check (char_length(trim(content)) > 0),
  constraint posts_channel_non_empty check (char_length(trim(channel)) > 0)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamp with time zone not null default now(),
  report_count integer not null default 0,
  hidden boolean not null default false,
  constraint comments_content_non_empty check (char_length(trim(content)) > 0)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id uuid not null,
  reporter_id uuid references public.users(id),
  created_at timestamp with time zone not null default now(),
  constraint reports_content_type_valid check (content_type in ('post', 'comment'))
);

-- Required feed indexes.
create index if not exists idx_posts_created_at_desc on public.posts (created_at desc);
create index if not exists idx_posts_expires_at on public.posts (expires_at);
create index if not exists idx_posts_channel on public.posts (channel);

-- Additional practical indexes.
create index if not exists idx_sessions_user_id on public.sessions (user_id);
create index if not exists idx_comments_post_id on public.comments (post_id);
create index if not exists idx_reports_content on public.reports (content_type, content_id);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;

-- No policies are created intentionally.
-- With RLS enabled and no policies, anon/authenticated cannot read/write rows.
-- service_role bypasses RLS and is used by this backend.

revoke all on table
  public.users,
  public.sessions,
  public.posts,
  public.comments,
  public.reports
from anon, authenticated, public;

grant all privileges on table
  public.users,
  public.sessions,
  public.posts,
  public.comments,
  public.reports
to service_role;

alter default privileges in schema public
revoke all on tables from anon, authenticated, public;

commit;
