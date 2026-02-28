-- Drift Phase 4: engagement, advice, and notification system

begin;

alter table public.users
  alter column trust_score set default 100;

update public.users
set trust_score = 100
where trust_score is null or trust_score < 1;

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reaction_type text not null,
  emoji text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (post_id, user_id),
  constraint post_reactions_reaction_type_valid check (reaction_type in ('like', 'dislike', 'emoji')),
  constraint post_reactions_emoji_required check (
    (reaction_type = 'emoji' and emoji is not null and char_length(emoji) between 1 and 16)
    or (reaction_type in ('like', 'dislike') and emoji is null)
  )
);

create table if not exists public.saved_posts (
  user_id uuid not null references public.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.advice_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamp with time zone not null default now(),
  hidden boolean not null default false,
  report_count integer not null default 0,
  constraint advice_posts_content_non_empty check (char_length(trim(content)) > 0),
  constraint advice_posts_content_len check (char_length(content) <= 800)
);

create table if not exists public.advice_replies (
  id uuid primary key default gen_random_uuid(),
  advice_id uuid not null references public.advice_posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamp with time zone not null default now(),
  hidden boolean not null default false,
  report_count integer not null default 0,
  constraint advice_replies_content_non_empty check (char_length(trim(content)) > 0),
  constraint advice_replies_content_len check (char_length(content) <= 800)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.users(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_post_reactions_post_id on public.post_reactions (post_id);
create index if not exists idx_post_reactions_user_id on public.post_reactions (user_id);
create index if not exists idx_saved_posts_user_id_created_at on public.saved_posts (user_id, created_at desc);
create index if not exists idx_saved_posts_post_id on public.saved_posts (post_id);
create index if not exists idx_advice_posts_created_at on public.advice_posts (created_at desc);
create index if not exists idx_advice_replies_advice_created_at on public.advice_replies (advice_id, created_at asc);
create index if not exists idx_notifications_recipient_created_at on public.notifications (recipient_id, created_at desc);
create index if not exists idx_notifications_type on public.notifications (type);

alter table public.post_reactions enable row level security;
alter table public.saved_posts enable row level security;
alter table public.advice_posts enable row level security;
alter table public.advice_replies enable row level security;
alter table public.notifications enable row level security;

revoke all on table
  public.post_reactions,
  public.saved_posts,
  public.advice_posts,
  public.advice_replies,
  public.notifications
from anon, authenticated, public;

grant all privileges on table
  public.post_reactions,
  public.saved_posts,
  public.advice_posts,
  public.advice_replies,
  public.notifications
to service_role;

commit;
