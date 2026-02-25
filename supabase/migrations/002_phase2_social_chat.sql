-- Drift Phase 2: post media, follows, and persistent personal chat

begin;

alter table public.posts
  add column if not exists image_url text,
  add column if not exists image_blurhash text;

create index if not exists idx_posts_user_created_at_desc
  on public.posts (user_id, created_at desc);

create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamp with time zone not null default now(),
  constraint messages_content_non_empty check (char_length(trim(content)) > 0)
);

create index if not exists idx_follows_follower_created_at
  on public.follows (follower_id, created_at desc);
create index if not exists idx_follows_following
  on public.follows (following_id);
create index if not exists idx_conversation_members_user
  on public.conversation_members (user_id, conversation_id);
create index if not exists idx_messages_conversation_created_at
  on public.messages (conversation_id, created_at asc);
create index if not exists idx_messages_sender_created_at
  on public.messages (sender_id, created_at desc);

alter table public.follows enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

revoke all on table
  public.follows,
  public.conversations,
  public.conversation_members,
  public.messages
from anon, authenticated, public;

grant all privileges on table
  public.follows,
  public.conversations,
  public.conversation_members,
  public.messages
to service_role;

commit;
