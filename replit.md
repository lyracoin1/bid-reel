# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Product

**BidReel** — short-video Arabic auction app MVP.
Users upload a video + image for an item, publish it as an auction, and other users browse a vertical TikTok-style feed to place bids. WhatsApp contact via server-generated deep-links (phone numbers never exposed in API responses). Dark theme, neon purple accent. RTL/Arabic first UI, with EN/AR switching.

## Running Services

Three services launched by the **"Start application"** workflow:
- **API server** — Express on `PORT=8080`, at `/api`
- **bidreel-web** — Vite React app on `PORT=24694`, at `/`
- **bidreel-admin** — Vite React admin panel on `PORT=22020`, at `/bidreel-admin/`

Workflow command:
```
PORT=8080 pnpm --filter @workspace/api-server run dev & PORT=24694 BASE_PATH=/ pnpm --filter @workspace/bidreel-web run dev & PORT=22020 BASE_PATH=/bidreel-admin/ pnpm --filter @workspace/bidreel-admin run dev & wait
```

## Auth

**Email-first auth** (Supabase email + password). Phone is a profile/contact field only — never used for authentication. Login uses `supabase.auth.signInWithPassword({ email, password })`. The `handle_new_auth_user` trigger on `auth.users` auto-creates a `profiles` row on signup.

Admin account: `lyracoin950@gmail.com` — `is_admin=true`, `is_completed=true` set by migration 019.

## Environment Variables

Shared env vars:
- `SUPABASE_URL` = `https://zhbfbjwagehwetyqljjr.supabase.co`

Secrets configured:
- `SUPABASE_ANON_KEY` — used by both Vite frontends (picked up as `process.env.SUPABASE_ANON_KEY` in vite.config.ts → `VITE_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` — used by API server only
- `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase Admin SDK for push notifications
- `Access_Key_ID`, `Secret_Access_Key`, `Account_id` — R2 object storage for media

## Database Schema

All migrations are SQL files in `artifacts/api-server/src/migrations/` and must be run manually in the Supabase SQL editor in order.

**Applied migrations (001–019):**
- `001`–`008` — initial schema: profiles, auctions, bids, likes, reports, blocks, notifications, devices
- `009_schema_alignment.sql` — renames `current_price`→`current_bid`, `minimum_increment`→`min_increment`; adds media lifecycle cols, winner_id; fixes bid trigger
- `010_unique_phone_constraint.sql` — UNIQUE on profiles.phone
- `011_bids_created_at.sql` — `created_at` on bids
- `012_add_lat_lng_to_auctions.sql` — `lat`, `lng` DOUBLE PRECISION on auctions
- `013_add_currency_to_auctions.sql` — `currency_code`, `currency_label` on auctions
- `014_user_follows.sql` — `user_follows` table + RLS
- `015_saved_auctions.sql` — `saved_auctions` table + RLS
- `016_add_username.sql` — `username` column on profiles (case-insensitive unique index)
- `017_profile_completion.sql` — `is_completed` flag + trigger (`trg_set_profile_completed`)
- `018_admin_notifications.sql` — `admin_notifications` table + triggers (new user/auction/report)
- `019_email_auth_and_admin_setup.sql` — `email` column on profiles; drops phone UNIQUE; `handle_new_auth_user` trigger; admin upsert for lyracoin950@gmail.com

**Key column names:**
- `auctions.current_bid`, `auctions.min_increment` (renamed from `current_price`/`minimum_increment` in migration 009 — old fallback code removed)
- `bids.user_id` (not `bidder_id` — Drizzle schema uses `userId`)
- `profiles.is_completed` — true once username is set (onboarding done)
- `profiles.email` — synced from auth.users via trigger

**Key tables:**
- `profiles` — `id, email, username, display_name, avatar_url, bio, phone, is_admin, is_completed, expo_push_token, created_at, updated_at`
- `auctions` — `id, seller_id, title, description, category, video_url, thumbnail_url, start_price, current_bid, min_increment, bid_count, like_count, status, starts_at, ends_at, media_purge_after, lat, lng, currency_code, currency_label, winner_id, winner_bid_id, ...`
- `bids` — `id, auction_id, user_id, amount, created_at`
- `notifications` — `id, user_id, type, message, auction_id, read, created_at`
- `admin_notifications` — `id, type, title, message, is_read, metadata, created_at`
- `user_follows` — `id, follower_id, following_id, created_at`
- `saved_auctions` — `id, user_id, auction_id, created_at`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm only (preinstall script enforces this)
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL via Supabase, Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Frontend**: React + Vite + Tailwind CSS v4
- **Auth**: Supabase Auth (email + password)
- **Build**: esbuild (API), Vite (frontends)

## Structure

```text
/
├── artifacts/
│   ├── api-server/          # Express API server (PORT=8080)
│   ├── bidreel-web/         # Main React app (PORT=24694, path=/)
│   └── bidreel-admin/       # Admin React panel (PORT=22020, path=/bidreel-admin/)
├── lib/
│   ├── api-spec/            # OpenAPI spec + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   └── db/                  # Drizzle ORM schema + DB connection
├── scripts/                 # Utility scripts
└── pnpm-workspace.yaml
```

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. All routes under `/api`.

Key files:
- `src/config/env.ts` — all `process.env` reads
- `src/routes/` — auth, auctions, bids, users, notifications, admin, media, reports
- `src/middlewares/requireAuth.ts` — Bearer JWT validation
- `src/lib/supabase.ts` — anon + service_role clients
- `src/lib/fcm.ts` — Firebase Admin push (no-op without `FIREBASE_SERVICE_ACCOUNT_JSON`)
- `src/lib/media-lifecycle.ts` — scheduled cleanup of expired media
- `src/services/` — business logic per domain

Scheduled jobs (run at startup and every minute):
- **media-lifecycle** — deletes expired auction media from Supabase Storage
- **profile-cleanup** — removes incomplete profiles older than 24h

### `artifacts/bidreel-web` (`@workspace/bidreel-web`)

Main user-facing React app. Served at `/`.

Key patterns:
- `src/lib/api-client.ts` — typed API client using `fetch`, Bearer JWT auth
- `src/lib/supabase.ts` — Supabase client for auth session management
- `src/contexts/LanguageContext.tsx` — EN/AR switching; reads `?lang=en|ar` URL param on init (used by admin preview panel to force locale)
- `src/lib/i18n.ts` — translation strings
- Auth flow: email+password → `supabase.auth.signInWithPassword` → JWT stored → API calls use Bearer token
- Feed: vertical scroll, TikTok-style; real data from `GET /api/auctions`
- Pages: `/login`, `/feed`, `/explore`, `/interests` (onboarding), `/profile`, `/auction/:id`, `/create-auction`

Vite config picks up Supabase creds:
- `VITE_SUPABASE_URL` or `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`

### `artifacts/bidreel-admin` (`@workspace/bidreel-admin`)

Admin panel. Served at `/bidreel-admin/`.

Key components:
- `src/components/AppPreviewPanel.tsx` — live iframe preview of bidreel-web with grouped screen nav (Entry/Auth/Onboarding/App), EN/AR locale toggle (passes `?lang=` to iframe), phone frame UI, refresh/open controls
- `src/lib/supabase.ts` — Supabase client (same creds as web app)
- `src/services/admin-api.ts` — typed API client for admin endpoints

Vite config extras:
- `VITE_APP_PREVIEW_URL` — set to `https://${REPLIT_DEV_DOMAIN}` in Replit dev; points to live bidreel-web for the iframe preview
- `VITE_API_URL` — API server URL (empty in dev = uses Vite proxy to localhost:8080)
- Proxy: `/api` → `localhost:8080` in dev

### `lib/db` (`@workspace/db`)

Drizzle ORM schema + DB connection. Exports `db` (Drizzle instance) and schema tables.

Schema files:
- `src/schema/auctions.ts` — `auctionsTable`
- `src/schema/bids.ts` — `bidsTable`
- `src/schema/notifications.ts` — `notificationsTable`

Note: `profiles` table is accessed directly via Supabase client in the API server (not through Drizzle), because profiles use Supabase Auth integration.

## TypeScript

Every package extends `tsconfig.base.json` (`composite: true`). Run `pnpm run typecheck` from root for full project build. Known pre-existing TS errors in `bidreel-web`: `use-bid-polling.ts`, `use-notifications.ts`, `use-realtime-bids.ts`, `public-profile.tsx` — these existed before the Replit migration and are not blocking.
