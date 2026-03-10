# VoidVault Backend

Production Cloudflare Workers API for VoidVault.

## Stack

- Cloudflare Workers (TypeScript)
- Supabase Postgres (service-role, backend only)
- Custom cookie/session auth
- Cloudinary (media upload signing)

## Architecture

Frontend (Pages) -> Worker -> Supabase + Cloudinary

The frontend never calls Supabase directly. All operations go through this Worker.

## Auth Model

- Username + password only
- No email, no OAuth, no third-party identity
- Sessions are DB-backed with hashed tokens in HTTP-only cookies
- **No password recovery flow** - password is the only credential. Users who lose their password must create a new account.
- Passwords are hashed using bcrypt before storage

## Security

- CORS: strict single-origin
- CSRF: token validation on all mutating requests
- Rate limiting: per-IP
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy
- Input sanitization and body-size limits
- Service-role DB key never exposed to frontend

## API

### Public
- `GET /` - health check
- `GET /username/suggest` - username suggestions
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
- `GET /follow`, `POST /follow`, `DELETE /follow`
- `GET /chat/list`, `POST /chat/start`
- `GET /chat/:id/messages`, `POST /chat/:id/message`
- `GET /advice`, `POST /advice`
- `GET /advice/:id/replies`, `POST /advice/:id/replies`
- `POST /account/password/change`
- `POST /account/deactivate`
- `DELETE /account`

### Admin (requires `X-Admin-Secret` header)
- `GET /admin/overview`
- `GET /admin/users`, `DELETE /admin/user`
- `POST /admin/user/moderation`
- `GET /admin/posts`, `POST /admin/post/hide`, `POST /admin/post/delete`
- `GET /admin/reports`
- `GET /admin/user-details` (IP/audit view)

## Environment Variables

Required secrets (set via `wrangler secret put`):
```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FRONTEND_ORIGIN
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
ADMIN_API_KEY
ADMIN_PASSWORD_ENCRYPTION_KEY
```

## Database Migrations

Apply in order from `supabase/migrations/`:
1. `001_phase1_foundation.sql`
2. `002_phase2_social_chat.sql`
3. `003_phase2_moderation_media.sql`
4. `004_phase3_security_profile_admin.sql`
5. `005_phase4_social_advice_engagement.sql`
6. `006_phase5_post_video_support.sql`
7. `007_phase6_password_auth.sql`
8. `008_phase7_password_ciphertext.sql`
9. `009_phase8_user_request_audit_logs.sql`
10. `010_phase9_admin_platform_settings.sql`
11. `011_phase10_report_reason.sql`

## Local Development

Create `backend/.dev.vars`:
```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key
FRONTEND_ORIGIN=http://localhost:5173
CLOUDINARY_CLOUD_NAME=your_name
```

```bash
cd backend
npm install
npm run dev
```

## Deploy

```bash
npx wrangler deploy
```
