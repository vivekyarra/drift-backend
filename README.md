# VoidVault Backend

Cloudflare Workers API for VoidVault.

## Stack
- Cloudflare Workers (TypeScript)
- Supabase Postgres (service-role only)
- Custom cookie/session auth
- Cloudinary (media signing)

## Auth Model
- Username + password only
- No email, no OAuth
- Sessions: DB-backed, hashed tokens, HTTP-only cookies
- Passwords: bcrypt hashed
- **No password recovery** - password is the only credential

## Security
- Strict single-origin CORS
- CSRF token validation on all mutations
- Per-IP rate limiting
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy
- Input sanitization, body-size limits

## API

### Public
- `GET /` - health
- `GET /username/suggest`
- `POST /register`
- `POST /login`

### Authenticated
- `POST /logout` · `GET /me` · `GET /feed` · `POST /post` · `DELETE /post`
- `POST /media/sign-upload` · `POST /report` · `GET /search`
- `GET /notifications`
- `GET|PATCH /profile`
- `GET|POST|DELETE /follow`
- `GET /chat/list` · `POST /chat/start`
- `GET|POST /chat/:id/messages`
- `GET|POST /advice` · `GET|POST /advice/:id/replies`
- `POST /account/password/change` · `POST /account/deactivate` · `DELETE /account`

### Admin (X-Admin-Secret header required)
- `GET /admin/overview`
- `GET|DELETE /admin/users` · `POST /admin/user/moderation`
- `GET /admin/posts` · `POST /admin/post/hide` · `POST /admin/post/delete`
- `GET /admin/reports` · `GET /admin/user-details`

## Secrets (set via `wrangler secret put`)
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

## Migrations (apply in order)
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

## Dev
Create `.dev.vars`:
```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key
FRONTEND_ORIGIN=http://localhost:5173
CLOUDINARY_CLOUD_NAME=your_name
```
```bash
npm install && npm run dev
```

## Deploy
```bash
npx wrangler deploy
```
