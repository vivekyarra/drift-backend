# Drift Backend (Phase 1)

Production-grade Cloudflare Worker backend for Drift Phase 1 using Supabase Postgres with a custom session model.

## Routes

- `POST /register`
- `POST /post` (authenticated)
- `GET /feed`
- `GET /me` (authenticated)
- `POST /follow` (authenticated)
- `DELETE /follow` (authenticated)
- `POST /chat/start` (authenticated)
- `GET /chat/:conversation_id/messages` (authenticated)
- `POST /chat/:conversation_id/message` (authenticated)

## Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` must be configured as a Wrangler secret.

## Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Apply database migration:
   - Run these migrations in order:
     - [`supabase/migrations/001_phase1_foundation.sql`](./supabase/migrations/001_phase1_foundation.sql)
     - [`supabase/migrations/002_phase2_social_chat.sql`](./supabase/migrations/002_phase2_social_chat.sql)
   - Execute them in Supabase SQL Editor (or your migration pipeline).

3. Configure runtime variables:
   - Set `SUPABASE_URL` in [`wrangler.toml`](./wrangler.toml) `[vars]`.
   - Set service key secret:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

4. Local development:
   - Optional local-only secrets in `.dev.vars`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

   - Start worker:

```bash
npm run dev
```

5. Type check:

```bash
npm run typecheck
```

## Production Deployment

1. Push repository to GitHub.
2. Connect repo in Cloudflare Workers (GitHub auto-deploy).
3. Configure production vars/secrets in Cloudflare:
   - `SUPABASE_URL` (plain var)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret)
4. Deploy:

```bash
npm run deploy
```

## Manual Steps Required

1. Run the SQL migration in Supabase (`backend/supabase/migrations/001_phase1_foundation.sql`).
   - Then run `backend/supabase/migrations/002_phase2_social_chat.sql`.
2. Configure Cloudflare Worker environment values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Ensure the worker only uses the service role key (no Supabase public client in backend runtime).
