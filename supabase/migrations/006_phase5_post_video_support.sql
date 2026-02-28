-- Drift Phase 5: post video support

begin;

alter table public.posts
  add column if not exists video_url text,
  add column if not exists video_public_id text;

create index if not exists idx_posts_video_url_not_null
  on public.posts (created_at desc)
  where video_url is not null;

commit;
