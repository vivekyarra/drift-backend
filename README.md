# Drift Backend (VoidVault API)

Production Cloudflare Workers backend for VoidVault.

## Stack
- Cloudflare Workers (TypeScript)
- Supabase Postgres (`@supabase/supabase-js`, service-role only)
- Cookie/session auth (custom, no Supabase Auth)
- Cloudinary signed upload support (URL-only media flow)

## Architecture
Browser -> Frontend (Pages) -> Worker API -> Supabase + Cloudinary

Frontend never talks directly to Supabase for auth/session operations.

## Core Capabilities
- Username + password auth
- Session cookies + DB-backed sessions
- Feed with cursor pagination
- Follows, chats, notifications
- Advice flows
- Reactions, saves, comments, reports
- Admin moderation APIs
- Admin personal-details API (IP/activity audit view)

## Security Controls
- Strict single-origin CORS
- CSRF validation for mutating requests
- IP rate limiting + abuse controls
- Input sanitization and body-size limits
- Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, etc.)
- Service-role DB access only from backend
- Recovery/session tokens stored hashed in DB

## API Surface
### Public
- `GET /`
- `GET /username/suggest`
- `POST /register`
- `POST /login`

### Authenticated
- `POST /logout`
- `GET /me`
- `GET /feed`
- `POST /post`
- `DELETE /post`
- `POST /media/sign-upload`
- `POST /report`
- `GET /search`
- `GET /notifications`
- `GET /profile`
- `PATCH /profile`
- `GET /follow`
- `POST /follow`
- `DELETE /follow`
- `GET /chat/list`
- `POST /chat/start`
- `GET /chat/:conversation_id/messages`
- `POST /chat/:conversation_id/message`
- `GET /advice`
- `POST /advice`
- `GET /advice/:advice_id/replies`
- `POST /advice/:advice_id/replies`
- `POST /account/recovery/rotate`
- `POST /account/password/change`
- `POST /account/deactivate`
- `DELETE /account`

### Admin (requires `X-Admin-Secret`)
- `GET /admin/overview`
- `GET /admin/users`
- `GET /admin/user-details`
- `DELETE /admin/user`
- `POST /admin/user/moderation`
- `GET /admin/posts`
- `POST /admin/post/hide`
- `POST /admin/post/delete`
- `GET /admin/reports`

## Environment Variables
Required:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_ORIGIN`
- `CLOUDINARY_CLOUD_NAME`

Optional:
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `ADMIN_API_KEY`
- `ADMIN_PASSWORD_ENCRYPTION_KEY`

## Local Development
```bash
cd backend
npm install
npm run dev
```

Use `backend/.dev.vars`:
```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
FRONTEND_ORIGIN=http://localhost:5173
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=optional
CLOUDINARY_API_SECRET=optional
ADMIN_API_KEY=optional
ADMIN_PASSWORD_ENCRYPTION_KEY=optional_32+_char_secret
```

## Quality Checks
```bash
npm run typecheck
npm run test
```

## Deploy
```bash
cd backend
npx wrangler deploy
```

Set secrets in Cloudflare before production deploy:
```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put CLOUDINARY_API_SECRET
wrangler secret put ADMIN_API_KEY
wrangler secret put ADMIN_PASSWORD_ENCRYPTION_KEY
```

## Database Migrations
Apply in order under `backend/supabase/migrations`:
1. `001_phase1_foundation.sql`
2. `002_phase2_social_chat.sql`
3. `003_phase2_moderation_media.sql`
4. `004_phase3_security_profile_admin.sql`
5. `005_phase4_social_advice_engagement.sql`
6. `006_phase5_post_video_support.sql`
7. `007_phase6_password_auth.sql`
8. `008_phase7_password_ciphertext.sql`
9. `009_phase8_user_request_audit_logs.sql`

`009_phase8_user_request_audit_logs.sql` is required for admin personal details (IP/audit view).

## Repository
- GitHub: https://github.com/vivekyarra/drift-backend
