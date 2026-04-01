# BidReel API Server

Express + Supabase backend for the BidReel MVP auction platform.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for the project to finish provisioning.

### 2. Run the database schema

In your Supabase project, open the **SQL Editor** and run the migration file in order:

```
artifacts/api-server/src/migrations/004_mvp_schema.sql
```

This creates the `profiles`, `auctions`, `bids`, and `reports` tables along with indexes, triggers, and RLS policies.

### 3. Configure environment secrets in Replit

Go to the **Secrets** tab in Replit and add:

| Secret | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key (keep private) |

### 4. Start the server

The `API Server` workflow starts automatically. To restart it manually:

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

---

## API Reference

All routes are prefixed with `/api`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Register with email + password |
| `POST` | `/api/auth/login` | — | Login with email + password |
| `POST` | `/api/auth/request-otp` | — | Send SMS OTP (phone login) |
| `POST` | `/api/auth/verify-otp` | — | Verify OTP, returns JWT |
| `GET` | `/api/auth/me` | Bearer | Get current user profile |

#### POST /api/auth/register
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "displayName": "Jane Doe"
}
```
Response `201`:
```json
{
  "message": "Account created",
  "token": "<jwt>",
  "user": { "id": "...", "email": "user@example.com", "displayName": "Jane Doe" }
}
```

#### POST /api/auth/login
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```
Response `200`:
```json
{
  "token": "<jwt>",
  "user": { "id": "...", "email": "user@example.com" }
}
```

---

### Auctions

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/auctions` | — | List active auctions |
| `POST` | `/api/auctions` | Bearer | Create a new auction |
| `GET` | `/api/auctions/:id` | — | Get auction + top bids |
| `POST` | `/api/auctions/:id/bids` | Bearer | Place a bid |

#### POST /api/auctions
```json
{
  "title": "Vintage Camera",
  "description": "Leica M6 in excellent condition",
  "category": "collectibles",
  "startPrice": 500,
  "minIncrement": 25,
  "videoUrl": "https://...",
  "thumbnailUrl": "https://..."
}
```
- `category`: one of `electronics`, `fashion`, `collectibles`, `home_and_garden`, `vehicles`, `jewelry`, `art`, `sports`, `other`
- `startPrice` / `minIncrement`: integers (cents) or decimals
- `ends_at` is automatically set to **3 days** from now

Response `201`: `{ "auction": { ... } }`

#### POST /api/auctions/:id/bids
```json
{ "amount": 550 }
```
Validation rules enforced by the server:
- `amount` must exceed `current_bid + min_increment`
- Auction must not be expired (`ends_at > now`)
- Bidder cannot be the auction's seller

Response `201`: `{ "bid": { ... }, "auction": { "current_bid": 550, ... } }`

Error responses:
- `409 AUCTION_NOT_ACTIVE` — auction has ended
- `403 SELLER_CANNOT_BID` — owner attempting to bid
- `422 BID_TOO_LOW` — amount below minimum, includes `minimumBid` in body

---

### Reports

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/reports` | Bearer | Submit a content report |

#### POST /api/reports
```json
{
  "auctionId": "<uuid>",
  "reason": "spam_or_fake",
  "details": "This item does not exist"
}
```
- `reason`: one of `spam_or_fake`, `offensive_content`, `prohibited_item`, `other`
- `details`: optional, max 500 characters
- One report per user per auction (duplicates return `409 ALREADY_REPORTED`)

Response `201`: `{ "report": { "id": "...", "status": "pending", ... } }`

---

## Authentication

Protected routes require a `Bearer` token in the `Authorization` header:

```
Authorization: Bearer <jwt>
```

Tokens are issued by `/api/auth/login` or `/api/auth/verify-otp`.

---

## Database schema overview

| Table | Purpose |
|---|---|
| `profiles` | User accounts (mirrors Supabase Auth) |
| `auctions` | Listings with denormalized bid/like counts |
| `bids` | Immutable bid events; trigger updates `auctions.current_bid` |
| `reports` | Policy violation reports, one per (user, auction) |

See `src/migrations/004_mvp_schema.sql` for full DDL.
