# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Product

**BidReel** — short-video auction mobile app MVP.
Users upload a video + image for an item, publish it as an auction (3-day fixed duration), and other users browse a vertical TikTok-style feed to place bids. WhatsApp contact via server-generated deep-links (phone numbers never exposed in API responses). Dark theme, neon purple accent.

### Database schema
Migration files:
- `lib/db/migrations/001_initial_schema.sql` — tables, indexes, triggers, views
- `lib/db/migrations/002_rls_policies.sql` — RLS enable + 27 policies + is_admin() helper
- `artifacts/api-server/src/migrations/002_bids_table.sql` — bids table + min_increment column
- `artifacts/api-server/src/migrations/003_notifications_table.sql` — notifications table + RLS + Realtime

Tables: `profiles`, `auctions`, `bids`, `likes`, `reports`, `blocks`, `contact_requests`, `moderation_queue`, `admin_actions`
Views: `v_public_profiles` (no phone), `v_auction_feed` (feed-optimized join), `v_admin_report_queue`
Triggers: `bid → update current_price + bid_count`, `like/unlike → update like_count`, `updated_at` on profiles + auctions
Enums: `auction_status`, `auction_category`, `report_reason`, `report_status`, `moderation_source`, `moderation_status`, `admin_action_type`, `admin_target_type`, `contact_status`

Key schema decisions:
- `profiles.phone` stored for wa.me generation only — excluded from `v_public_profiles` view
- `auctions.current_price` + `bid_count` + `like_count` are denormalized counters updated by DB triggers
- `auctions.ends_at` has a CHECK constraint enforcing 3-day window from `created_at` (±1hr tolerance)
- `bids` are immutable (no UPDATE/DELETE); trigger updates auction current_price on INSERT
- `likes` have UNIQUE(user_id, auction_id) — ON CONFLICT DO NOTHING for idempotent behavior
- `blocks` have CHECK(blocker_id != blocked_id) for self-block prevention
- `admin_actions` is append-only audit log — polymorphic target_id (not a DB FK)
- `moderation_queue` has UNIQUE(auction_id, source) — multiple reports roll up to one queue entry

### Backend implementation status
Auth routes implemented:
- `POST /api/auth/request-otp` — sends SMS OTP via Supabase Auth
- `POST /api/auth/verify-otp` — verifies OTP, upserts profile, returns JWT + PublicProfile
- `GET /api/auth/me` — validates token, returns current user's profile

New files:
- `artifacts/api-server/src/lib/supabase.ts` — `supabase` (anon) + `supabaseAdmin` (service_role)
- `artifacts/api-server/src/lib/profiles.ts` — `upsertProfile()` + `getProfileById()` (never returns phone)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — JWT middleware, attaches `req.user`
- `artifacts/api-server/src/routes/auth.ts` — OTP + me routes

### Key API design decisions
- Phone-based OTP auth → Bearer JWT token
- Feed: cursor-paginated, active auctions only, sorted by ending soonest, blocked users excluded
- Auction creation: multipart/form-data (video + thumbnail + metadata), files → Supabase Storage
- Bids: server validates amount > currentBid, seller cannot bid own auction, expired auctions reject bids
- Likes: idempotent POST/DELETE, optimistic-update friendly
- Contact: `/auctions/:id/contact` returns a `wa.me` URL — phone number embedded server-side, never returned in JSON
- Admin endpoints: gated by `isAdmin` flag on user, actions: resolve reports, remove auctions, ban/unban users

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server for BidReel. Uses Supabase for auth, database, and storage.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- `pnpm --filter @workspace/api-server run dev` — build + start dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.mjs`)
- `.env.example` — reference for all required environment variables

**Folder structure:**
- `src/config/env.ts` — centralized env var access (all `process.env` reads live here)
- `src/routes/` — HTTP layer: parse request, call lib/service, send response
  - `auth.ts` — POST /register, POST /login, POST /request-otp, POST /verify-otp, GET /me
  - `auctions.ts` — GET/POST /auctions, GET /auctions/:id, POST /auctions/:id/bids
  - `reports.ts` — POST /reports
  - `notifications.ts` — notification routes
  - `admin.ts` — admin-only routes (protected by ADMIN_SECRET)
- `src/controllers/` — scaffolded; will hold extracted handler logic as routes grow
- `src/services/` — scaffolded; will hold business logic and DB calls per domain
  - `auctions.service.ts`, `bids.service.ts`, `auth.service.ts`, `reports.service.ts`, `blocks.service.ts`, `winners.service.ts`
- `src/middlewares/requireAuth.ts` — Bearer JWT validation, attaches `req.user`
- `src/lib/` — shared utilities: `supabase.ts`, `logger.ts`, `profiles.ts`, `notifications.ts`, `fcm.ts` (Firebase Admin push), `media-lifecycle.ts`, `devAuth.ts`
- `src/utils/` — `response.ts` (typed HTTP helpers), `validation.ts` (Zod helpers + parseOrBadRequest), `pagination.ts` (cursor pagination)
- `src/migrations/` — SQL files to run in Supabase SQL editor in order
  - `001_auctions_media_lifecycle.sql` — auctions table with media lifecycle columns
  - `002_bids_table.sql` — bids table + min_increment
  - `003_notifications_table.sql` — notifications table + RLS + Realtime (**currently applied**)
  - `004_mvp_schema.sql` — consolidated MVP schema (profiles, auctions, bids, reports)
  - `005_complete_mvp_schema.sql` — authoritative schema superseding 001–004 (not yet applied)
  - `006_rls_policies.sql` — complete RLS policy set (not yet applied)
  - `007_user_devices.sql` — FCM device token table (not yet applied)
  - `009_schema_alignment.sql` — renames `current_price`→`current_bid`, `minimum_increment`→`min_increment`; adds `media_purge_after`, `winner_id`, deletion-tracking cols; fixes bid trigger. **Optional — API server now handles both old and new column names automatically.**
  - `010_unique_phone_constraint.sql` — adds UNIQUE constraint on profiles.phone
  - `011_bids_created_at.sql` — adds `created_at` column to bids table (optional but recommended)

**User profile routes (`src/routes/users.ts`):**
- `GET /api/users/me` — own profile (displayName, avatarUrl, bio, auctionCount, bidsPlacedCount, totalLikesReceived)
- `PATCH /api/users/me` — update own profile (displayName, avatarUrl, bio)
- `GET /api/users/me/bids` — auctions the caller has bid on with isLeading/outbid status + their highest bid
- `GET /api/users/:userId` — another user's public profile

**Live DB schema (fully aligned as of 2026-04-02):**
- `bids`: `id, auction_id, bidder_id, amount, created_at` — fully aligned with all code
- `auctions`: uses `current_bid` + `min_increment` (new names); has `video_deleted_at`, `thumbnail_deleted_at`, `media_purge_after`, `winner_id`, `starts_at`
- `profiles`: has `expo_push_token`; `phone` has UNIQUE constraint (`profiles_phone_unique`)
- Bid trigger: `fn_bid_placed()` updates `current_bid` + `bid_count` + `updated_at` on each INSERT into bids
- View `v_auction_feed`: updated to reference `current_bid`, `min_increment`
- All migrations 009, 010, 011 applied. Media lifecycle runs cleanly at startup.
- **Schema-agnostic helpers** remain active: `getBidderCol()` + `getBidderUserId()` in `src/lib/dbSchema.ts` handle any future DB variations
- `insertAuction()` in `auctions.ts` still uses 3-attempt fallback for robustness across schema variants

**Video & Location features (create-auction page):**
- Video upload: presigned URL → direct PUT to Supabase Storage → URL returned and stored in auction
- Video preview: shows `<video>` player with green border, file name badge, "Change" and "Delete" buttons
- Delete video before publish: clears form state (no orphan — video is only uploaded at submit time)
- Replace video: after deleting, user can pick a new file without issues
- Geolocation: requested immediately on page load; status machine: idle → requesting → granted/denied/unavailable
- Location status badge shown in step 2 with animated dot; "Retry" button for denied state
- Publish button is blocked (greyed out, shows MapPin icon) if location not granted
- Backend: lat/lng required in `POST /api/auctions` (Zod validated); rejects with 400 if missing
- Backend: attempts to store lat/lng in DB; gracefully falls back if `lat`/`lng` columns don't exist yet
- Migration 012 (`012_add_lat_lng_to_auctions.sql`): **APPLIED** — `lat DOUBLE PRECISION` + `lng DOUBLE PRECISION` columns exist on auctions table
- All location/video UI strings available in ar/en/ru/es/fr via i18n system

**Distance + Currency features:**
- `src/lib/geo.ts`: Haversine distance calc, `formatDistance(metres, lang)`, country→currency map (40+ countries incl. Arab world), Nominatim reverse-geocoding (`reverseGeocode`), `formatAuctionPrice(amount, currencyCode)` for locale-aware price display
- `src/hooks/use-viewer-location.ts`: singleton hook — fetches once per session via `navigator.geolocation`, cached at module level, returns `{lat, lng} | null`
- Currency stored at auction creation time in creator's currency — **no conversion ever**
- `POST /api/auctions` accepts `currencyCode` + `currencyLabel`; persisted in DB via `insertAuction()`
- Create-auction step 2: currency selector (USD vs Local), auto-detected from geolocation + reverse-geocoding
- FeedCard: distance badge (e.g. "2.3 km") shown if viewer location + auction lat/lng available; price uses `formatAuctionPrice` with stored `currencyCode`
- auction-detail: distance badge + all price/bid displays use stored currency via `fmtPrice(amount)`
- Migration 013 (`013_add_currency_to_auctions.sql`): **APPLIED** — `currency_code TEXT NOT NULL DEFAULT 'USD'` + `currency_label TEXT NOT NULL DEFAULT 'US Dollar'` on auctions table
- `insertAuction()` fallback chain fixed: Fallback A tries without lat/lng (keeps currency); Fallback B tries without currency (keeps lat/lng); Fallback C drops both — so currency is never silently lost

**Admin activation:**
- `POST /api/users/me/activate-admin` — validates secret code (`ADMIN_ACTIVATION_CODE` env var) server-side; sets `is_admin=true` in profiles table
- Profile page: shows violet "أنت أدمن" badge if admin; otherwise shows activation form to enter code

**Three-dot auction menu (AuctionMenu.tsx):**
- `DELETE /api/auctions/:id` — soft-deletes auction (owner-only); sets `deleted_at` timestamp
- Bottom sheet with Share / Download / Delete options; integrated in FeedCard and auction-detail
- Delete triggers confirmation dialog; on success navigates back to feed

**Mock data elimination status (frontend):**
- `mockAuctions`, `mockUsers`, `currentUser` are no longer used in any component or hook
- `mock-data.ts` retains only the type definitions (`User`, `Auction`, `Bid`) — these are still imported as types
- `use-current-user.ts` — new hook with module-level cache; fetches `GET /api/users/me` once on load, exposes `useCurrentUser()` and imperative `getCurrentUserId()` / `getCachedCurrentUser()` helpers
- `profile.tsx` — fully real: user avatar/name from API, listings from global auction cache filtered by `seller.id === me.id`, bids from `GET /api/users/me/bids`
- `auction-detail.tsx` — `isSeller` derived from real user ID comparison
- `use-auctions.ts` `usePlaceBid` — uses `getCachedCurrentUser()` to build the optimistic bid entry in local cache
- `use-realtime-bids.ts` — uses `getCurrentUserId()` to distinguish own bids from others

**FCM Push Notifications:**
- Backend: `src/lib/fcm.ts` — Firebase Admin SDK, lazy-initialised, no-op without `FIREBASE_SERVICE_ACCOUNT_JSON`
- Trigger: `notifyOutbid` and `notifyAuctionStarted` in `notifications.ts` fire both DB insert + FCM push
- Device registration: `POST /api/notifications/register-device`, `DELETE /api/notifications/unregister-device`
- Frontend: `src/lib/firebase.ts` + `src/hooks/use-fcm-token.ts` + `public/firebase-messaging-sw.js`
- Graceful degradation: app runs normally without Firebase configured; console logs helpful setup instructions

**Firebase setup (one-time):**
1. Create Firebase project → Enable Cloud Messaging → Add Web App
2. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` on the frontend
3. Set `FIREBASE_SERVICE_ACCOUNT_JSON` (service account JSON string) on the API server
4. Apply migration `007_user_devices.sql` in Supabase SQL editor

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
