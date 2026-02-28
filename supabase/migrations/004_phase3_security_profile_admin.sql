-- Drift Phase 3: security/profile/admin hardening

begin;

alter table public.users
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_banned boolean not null default false,
  add column if not exists is_shadow_banned boolean not null default false,
  add column if not exists deactivated_at timestamp with time zone,
  add column if not exists banned_at timestamp with time zone;

alter table public.sessions
  add column if not exists expires_at timestamp with time zone;

create index if not exists idx_users_active_created_at
  on public.users (is_active, created_at desc);
create index if not exists idx_users_shadow_ban
  on public.users (is_shadow_banned)
  where is_shadow_banned = true;
create index if not exists idx_sessions_expires_at
  on public.sessions (expires_at);

-- Pagination and lookup indexes.
create index if not exists idx_posts_created_at on public.posts (created_at desc);
create index if not exists idx_follows_follower_id on public.follows (follower_id);
create index if not exists idx_messages_conversation_id on public.messages (conversation_id);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_user_id uuid references public.users(id),
  target_post_id uuid references public.posts(id),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_admin_actions_created_at
  on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;
revoke all on table public.admin_actions from anon, authenticated, public;
grant all privileges on table public.admin_actions to service_role;

commit;
