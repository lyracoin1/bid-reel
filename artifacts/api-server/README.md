# BidReel API Server

Express + Supabase backend for the BidReel MVP short-video auction platform.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for provisioning to finish.

### 2. Run the database schema

In your Supabase project, open the **SQL Editor** and run:

```
artifacts/api-server/src/migrations/004_mvp_schema.sql
```

This creates all tables (`profiles`, `auctions`, `bids`, `reports`), indexes, triggers, and RLS policies.

### 3. Configure secrets in Replit

Add these in the **Secrets** tab (or copy `.env.example` to `.env` for local dev):

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key |

Optional:

| Variable | Purpose |
|---|---|
| `ADMIN_SECRET` | Protects `/api/admin/*` routes |
| `USE_DEV_AUTH=true` | Enables `POST /api/auth/dev-login` (dev only) |

### 4. Start the server

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

---

## Project structure

```
src/
├── index.ts                  Entry point — reads PORT, starts Express
├── app.ts                    Express app setup (CORS, logging, routes)
│
├── config/
│   └── env.ts                Centralized env var access (all process.env reads live here)
│
├── routes/                   HTTP layer — parse request, call service/lib, send response
│   ├── index.ts              Mounts all sub-routers under /api
│   ├── health.ts             GET /api/health
│   ├── auth.ts               Auth routes (register, login, OTP, me)
│   ├── auctions.ts           Auction + bid routes
│   ├── reports.ts            Report routes
│   └── notifications.ts      Notification routes
│
├── controllers/              (Scaffolded — will hold extracted handler logic)
│   ├── auth.controller.ts
│   ├── auctions.controller.ts
│   ├── bids.controller.ts
│   ├── reports.controller.ts
│   └── blocks.controller.ts
│
├── services/                 (Scaffolded — will hold business logic + DB calls)
│   ├── auth.service.ts
│   ├── auctions.service.ts
│   ├── bids.service.ts
│   ├── reports.service.ts
│   ├── blocks.service.ts
│   └── winners.service.ts
│
├── middlewares/
│   └── requireAuth.ts        Bearer JWT validation — attaches req.user
│
├── lib/                      Shared utilities and integrations
│   ├── supabase.ts           Supabase anon + admin clients
│   ├── logger.ts             Pino logger instance
│   ├── profiles.ts           upsertProfile / getProfileById
│   ├── notifications.ts      Outbid push notification logic
│   ├── media-lifecycle.ts    Scheduled media cleanup (videos → 7d, images → 14d)
│   └── devAuth.ts            Dev-only login bypass
│
├── utils/
│   ├── response.ts           Typed HTTP response helpers (ok, created, notFound, etc.)
│   ├── validation.ts         Zod schemas + parseOrBadRequest helper
│   └── pagination.ts         Cursor-based pagination helper
│
└── migrations/               SQL files — run in Supabase SQL editor in order
    ├── 001_auctions_media_lifecycle.sql
    ├── 002_bids_table.sql
    ├── 003_notifications_table.sql
    └── 004_mvp_schema.sql    ← Consolidated MVP schema (start here)
```

---

## API Reference

All routes are prefixed with `/api`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Email + password sign-up |
| `POST` | `/api/auth/login` | — | Email + password sign-in, returns JWT |
| `POST` | `/api/auth/request-otp` | — | Send SMS OTP to phone number |
| `POST` | `/api/auth/verify-otp` | — | Verify OTP, returns JWT |
| `GET` | `/api/auth/me` | Bearer | Get current user profile |

#### POST /api/auth/register
```json
{ "email": "user@example.com", "password": "securepass", "displayName": "Jane" }
```
Response `201`: `{ "token": "...", "user": { "id": "...", "email": "..." } }`

#### POST /api/auth/login
```json
{ "email": "user@example.com", "password": "securepass" }
```
Response `200`: `{ "token": "...", "user": { "id": "...", "email": "..." } }`

---

### Auctions

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/auctions` | — | List active auctions (feed) |
| `POST` | `/api/auctions` | Bearer | Create a new auction |
| `GET` | `/api/auctions/:id` | — | Auction detail + top bids |
| `POST` | `/api/auctions/:id/bids` | Bearer | Place a bid |

#### POST /api/auctions
```json
{
  "title": "Vintage Camera",
  "description": "Leica M6, excellent condition",
  "category": "collectibles",
  "startPrice": 500,
  "minIncrement": 25,
  "videoUrl": "https://...",
  "thumbnailUrl": "https://..."
}
```
Categories: `electronics`, `fashion`, `collectibles`, `home_and_garden`, `vehicles`, `jewelry`, `art`, `sports`, `other`

Auction `ends_at` is automatically set to **3 days** from creation.

#### POST /api/auctions/:id/bids
```json
{ "amount": 550 }
```

Enforced validation:
- `amount > current_bid + min_increment`
- Auction must not be expired
- Bidder cannot be the seller

Errors: `409 AUCTION_NOT_ACTIVE` · `403 SELLER_CANNOT_BID` · `422 BID_TOO_LOW`

---

### Reports

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/reports` | Bearer | Submit a content violation report |

```json
{
  "auctionId": "<uuid>",
  "reason": "spam_or_fake",
  "details": "Optional description"
}
```
Reasons: `spam_or_fake`, `offensive_content`, `prohibited_item`, `other`

One report per (user, auction) — duplicates return `409 ALREADY_REPORTED`.

---

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server health check |

---

## Authentication

Include the JWT in every protected request:

```
Authorization: Bearer <token>
```

Tokens are issued by `/api/auth/login` or `/api/auth/verify-otp`.

---

## Database tables

| Table | Purpose |
|---|---|
| `profiles` | User accounts — mirrors Supabase Auth |
| `auctions` | Listings with denormalized counters (`current_bid`, `bid_count`, `like_count`) |
| `bids` | Immutable bid events — trigger keeps `auctions.current_bid` in sync |
| `reports` | Policy violation reports, one per (reporter, auction) pair |

Planned tables (schema in `004_mvp_schema.sql`):

| Table | Purpose |
|---|---|
| `blocks` | User block relationships — excluded from feed |
| `auction_winners` | Winner record created when auction ends (no payment logic) |
| `contact_requests` | Audit log for WhatsApp contact link generation |
| `moderation_queue` | Aggregated moderation items for admin review |
| `admin_actions` | Append-only audit log of admin decisions |

See `src/migrations/004_mvp_schema.sql` for full DDL.

---

## Product rules

- No payment processing, commissions, wallets, or escrow
- Phone numbers are never exposed in API responses
- WhatsApp contact is handled server-side via `wa.me` deep links
- All content is subject to reporting and admin moderation
- Built for Google Play compliance from the start
