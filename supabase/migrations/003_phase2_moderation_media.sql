-- Drift Phase 2.1: media cleanup + moderation hardening

begin;

alter table public.posts
  add column if not exists image_public_id text,
  add column if not exists deleted_at timestamp with time zone;

create index if not exists idx_posts_active_feed_created_at_desc
  on public.posts (created_at desc)
  where hidden = false and deleted_at is null;

create index if not exists idx_posts_deleted_at
  on public.posts (deleted_at);

-- Prevent duplicate reports by the same reporter on the same content.
create unique index if not exists idx_reports_unique_reporter_content
  on public.reports (content_type, content_id, reporter_id)
  where reporter_id is not null;

commit;
