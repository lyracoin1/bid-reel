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
- `src/lib/` — shared utilities: `supabase.ts`, `logger.ts`, `profiles.ts`, `notifications.ts`, `media-lifecycle.ts`, `devAuth.ts`
- `src/utils/` — `response.ts` (typed HTTP helpers), `validation.ts` (Zod helpers + parseOrBadRequest), `pagination.ts` (cursor pagination)
- `src/migrations/` — SQL files to run in Supabase SQL editor in order
  - `004_mvp_schema.sql` — consolidated MVP schema (profiles, auctions, bids, reports) with RLS

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
