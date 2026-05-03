# Overview

BidReel is a pnpm workspace monorepo using TypeScript, designed for a short-video Arabic auction mobile application. The core idea is to enable users to upload video and image content for items, host them as auctions, and allow other users to browse a TikTok-style vertical feed to place bids. A key feature is direct WhatsApp contact for auction winners via server-generated deep-links, ensuring user privacy by never exposing phone numbers in API responses. The application features a dark theme with a neon purple accent and prioritizes a RTL/Arabic-first UI with support for English/Arabic language switching.

The project's vision is to capture a significant share of the online auction market in Arabic-speaking regions by offering a novel, engaging, and secure bidding experience centered around video content. It aims to create a dynamic marketplace that is intuitive, visually appealing, and fosters community engagement through interactive auctions.

# User Preferences

I prefer concise and direct communication.
When suggesting code changes, provide clear reasoning and highlight potential impacts.
For new features, I prefer an iterative development approach with frequent, small commits.
Please ask for confirmation before making any significant architectural changes or adding new external dependencies.
I prefer detailed explanations for complex technical decisions.
Do not make changes to the `artifacts/bidreel-web/android/app/src/main/java/com/bidreel/app/VideoCompressorPlugin.java` file.
Do not make changes to the `artifacts/bidreel-web/src/lib/native-video-compressor.ts` file.

# System Architecture

## UI/UX Decisions

The application adopts a dark theme with a neon purple accent, providing a modern and visually distinct interface. The UI is designed to be RTL/Arabic-first, supporting full Arabic localization with English as an alternative. The primary user interaction model is a vertical, TikTok-style video feed for browsing auctions.

## Technical Implementations

### Monorepo Structure
The project is organized as a pnpm workspace monorepo, facilitating shared dependencies and consistent tooling across multiple services.

### Video Upload and Compression
A critical architectural decision is that all videos *must* be compressed client-side before upload. Raw video files are never directly uploaded to storage.
- **Android:** Utilizes a native Capacitor plugin (`VideoCompressorPlugin.java`) with Media3 Transformer for H.264 (2 Mbps) / AAC / MP4 / 720p re-encoding.
- **iOS:** UI indicates that video posting is not yet enabled, awaiting native plugin implementation.
- **Web:** Video posting is disabled.

### Authentication
The system uses an email-first authentication strategy powered by Supabase email and password, with Google Sign-In as an OAuth option. Phone numbers are for contact only, not authentication. New users are directed to an onboarding flow (`/interests`), while existing users directly access the main feed (`/feed`).

### Rule/Safety Notice Flow
There are three distinct rule surfaces:
1.  **Onboarding rules step:** Presented once after initial profile setup.
2.  **Listing rules modal:** Appears on the first auction publish.
3.  **Bidding rules modal:** Appears on the first bid submission.
All modals include "Confirm" (proceeds with action), "Skip" (closes without action), and a link to a full safety rules page. Language handling supports `en/ar/ru/es/fr` with RTL rendering for Arabic.

### Media Processing
After an auction is created with a video, a server-side fire-and-forget process transcodes the video to 720p H.264/AAC, extracts a JPEG thumbnail, updates the auction record, and deletes the original uncompressed file.

### Feed Intelligence Ranking
The API server dynamically ranks auctions for authenticated users based on a weighted additive scoring model incorporating explicit user signals (interested/not interested), bidding history, saved auctions, followed sellers, and category preferences. Anonymous users see auctions by recency.

## Feature Specifications

### Core Auction Functionality
Users can upload videos/images to create auctions. Other users can browse, bid, and interact with auctions.

### User Profiles
Includes `username`, `display_name`, `avatar_url`, `bio`, `phone`, `email`, `is_admin`, and `is_completed` status. `is_completed` is set once the username is configured.

### Notifications
Supports in-app notifications and push notifications (via Firebase) for events like new bids, auction status changes, and admin messages.

### Admin Panel
A separate React admin panel provides tools for managing the application, including a live preview of the main web app with locale switching.

### Secure Deals (Transactions)

A peer-to-peer escrow-style "Secure Deal" feature for off-auction sales:
- **Seller** creates a deal via `/secure-deals/create` → a payment link is generated.
- **Buyer** opens the link at `/secure-deals/pay/:dealId` → auth-gated, sees deal details, and confirms payment.
- **Data flow:** all transaction data is stored in the Replit PostgreSQL `transactions` table (not Supabase cloud) via the api-server at `POST/GET /api/secure-deals/*`.
- **Auth:** GET is public (buyer can read deal without auth); POST/pay/ship require a valid Supabase JWT (`requireAuth` middleware).
- **Payment gateway:** placeholder block in `artifacts/api-server/src/routes/secure-deals.ts` (POST /:dealId/pay). Replace with Google Play Billing / Stripe before going live.
- **Notifications:** placeholder in the same route. Wire real FCM or Email there.
- Table bootstraps automatically on api-server startup via `bootstrapTransactionsTable()` (idempotent).
- Route registration: `secureDealsRouter` must be mounted **before** `notificationRouter` in `routes/index.ts` because that router applies a global `requireAuth` to all subsequent handlers.

#### Secure Deals — Feature Parts

**Part #1 — Buyer Conditions** (migration 042, `deal_conditions` table)
- `POST/GET /api/deal-conditions` — buyer submits terms; seller receives FCM + in-app notification.
- UI: violet-accented card in `secure-deal-pay.tsx`.

**Part #2 — Seller Conditions** (migration 043, `seller_conditions` table)
- `POST/GET /api/seller-conditions` — seller submits counter-conditions; buyer receives notification.
- UI: amber-accented card in `secure-deal-pay.tsx`.

**Part #3 — Deal Ratings** (migration 044, `deal_ratings` table)
- `POST /api/deal-ratings`, `GET /api/deal-ratings/:dealId` — 5-star rating after delivery.
- UI: emerald-header, amber-stars card in `secure-deal-pay.tsx` (delivered deals only).

**Part #4 — Buyer Payment Proof Upload** (migration 045, `payment_proofs` table)
- `POST /api/payment-proof` — raw binary upload to R2 under `payment-proofs/{buyerId}/{uuid}.{ext}`.
  - Accepts PDF, JPEG, PNG, WebP up to 10 MB. Uses `express.raw()` middleware, same as media uploads.
  - Upserts `payment_proofs` (UNIQUE deal_id) so re-uploads replace previous proof.
  - Notifies seller via FCM + in-app notification (`"payment_proof_uploaded"`).
- `GET /api/payment-proof/:dealId` — returns proof for buyer, seller, or admin.
- `GET /api/admin/payment-proofs` — lists all proofs across all deals (admin-only, uses `requireAdmin`).
  - Registered via `paymentProofRouter` **before** `adminRouter` in `routes/index.ts` so the `/admin/payment-proofs` path is intercepted before the broader `/admin/*` subrouter.
- UI (buyer): sky-blue card with file picker between Progress Stepper and Payment Card in `secure-deal-pay.tsx`.
- UI (seller): read-only view of uploaded proof (filename + date + View link).
- Admin: collapsible "إثباتات الدفع" panel at top of `SecureDeals.tsx` with real data from API (deal ID, product, price, filename, type, size, date, View link). Uses `adminGetPaymentProofs()` from `admin-api.ts`.
- Client helpers: `uploadPaymentProof(dealId, File)` and `getPaymentProof(dealId)` in `transactions.ts`.

**Part #5 — Seller Shipment Proof Upload + Tracking Link** (migration 046, `shipment_proofs` table)
- `POST /api/shipment-proof` — raw binary upload to R2 under `shipment-proofs/{sellerId}/{uuid}.{ext}`.
  - Accepts PDF, JPEG, PNG, WebP up to 10 MB. Uses `express.raw()` middleware.
  - Only the deal's `seller_id` may upload (403 `NOT_SELLER` if buyer or third party tries).
  - Query params: `dealId`, `mimeType`, `fileName`, `trackingLink` (URL-encoded). Tracking link is optional (empty string = local pickup).
  - Upserts `shipment_proofs` (UNIQUE deal_id, seller_id) — re-upload replaces the DB row (old R2 file orphaned).
  - Notifies buyer via FCM + in-app notification (`"shipment_proof_uploaded"`) — non-fatal.
- `GET /api/shipment-proof/:dealId` — returns proof to seller, buyer, or admin.
- `GET /api/admin/shipment-proofs` — lists all proofs with deal metadata (admin-only).
  - Registered via `shipmentProofRouter` **before** `adminRouter` in `routes/index.ts` (same pattern as paymentProofRouter).
- UI (seller): indigo-accented "إثبات الشحن" card inserted between the Payment Card and Rating Card in `secure-deal-pay.tsx`.
  - Visible when `dealStatus === "payment_secured"` → upload form with tracking link input + file picker.
  - Shows read-only existing proof (file link + tracking URL + upload date) when proof exists.
  - Can re-upload; buyer receives a notification banner.
- UI (buyer): same card in read-only mode — shows file link, tracking link, and upload date when proof exists; waiting message if seller hasn't uploaded yet.
- Admin: collapsible orange-accented "إثباتات الشحن" panel in `SecureDeals.tsx` after the payment proofs panel, with deal ID, product, price, tracking link (clickable), upload date, View and Download buttons.
- Client helpers: `uploadShipmentProof(dealId, File, trackingLink)` and `getShipmentProof(dealId)` in `transactions.ts`.

**Part #10 — Seller Penalty System** (migration 050, `seller_penalties` table)
- `seller_penalties` table in Replit Postgres (pg-pool.ts bootstrap), auto-created at startup:
  - `id UUID PK DEFAULT gen_random_uuid()`, `deal_id TEXT NOT NULL`, `seller_id UUID NOT NULL`, `reason TEXT NOT NULL`
  - `penalty_type TEXT CHECK ('warning'|'fee'|'suspension'|'other')`, `amount NUMERIC(12,2)` (optional), `resolved BOOLEAN DEFAULT false`, `created_at TIMESTAMPTZ DEFAULT now()`
  - Indexes on `deal_id` and `seller_id`.
- `POST /api/seller-penalty` — admin-only JSON: `{deal_id, seller_id, reason, penalty_type, amount?}`:
  - Validates deal exists. Validates `seller_id === deal.seller_id` (422 `SELLER_MISMATCH` if wrong).
  - Inserts penalty, notifies seller via `seller_penalty_applied` push + in-app notification (non-fatal).
  - Returns `{penalty}` (201).
- `GET /api/seller-penalties/:sellerId?dealId=` — seller reads own (403 if not own); admin reads any. Optional `?dealId=` filter.
- `PATCH /api/seller-penalty/:id/resolve` — admin only; sets `resolved = TRUE`, returns updated row.
- `GET /api/admin/seller-penalties` — admin list all penalties joined with transactions (`product_name`, `currency`, `price`).
- Notification type `"seller_penalty_applied"` added to `NotificationType` union + `PUSH_ENABLED` set in `notifications.ts`.
- Migration `050_seller_penalties.sql` extends Supabase `notifications.type` CHECK constraint (run in Supabase SQL Editor).
- Admin Dashboard (`SecureDeals.tsx`):
  - Collapsible red-accented "عقوبات البائعين" panel after the Shipping Fee Disputes panel.
  - Active-count badge in panel header. "إضافة عقوبة جديدة" expand/collapse inline form:
    - Deal selector (dropdown from loaded fullDeals, auto-fills seller_id).
    - Penalty type select (`warning`/`fee`/`suspension`/`other`). Amount input shown only for `fee` type.
    - Reason textarea. Gavel submit button — on success prepends penalty to list.
  - Penalties table: deal ID, product name, price, penalty type badge + amount, reason (2-line clamp), date, resolved status badge.
  - "حل" (Resolve) button per unresolved row — calls PATCH, updates local state in place.
  - Inside `FullDealExpandedRow`: "عقوبات البائع" SubSection (shown only when `deal.seller_penalties.length > 0`) with per-penalty cards showing type badge, reason, amount, date, resolved status.
- Seller UI (`secure-deal-pay.tsx`):
  - Penalty card (#10) inserted after the Shipping Fee Dispute card and before the Deal Rating card.
  - Visible only when `tx.seller_id === user.id && penalties.length > 0`.
  - Red-accented read-only list of all penalties for this specific deal.
  - Each row: penalty type badge, amount (if any), reason, date, resolved/active indicator.
  - `loadPenalties` callback via `getMyPenalties(tx.seller_id, tx.deal_id)` — non-fatal (empty card if error).
- Client helpers: `SellerPenalty` interface + `getMyPenalties(sellerId, dealId?)` in `transactions.ts`.
- Admin helpers: `AdminSellerPenalty`, `FullDealSellerPenalty`, `adminGetSellerPenalties()`, `adminCreateSellerPenalty()`, `adminResolveSellerPenalty()` in `admin-api.ts`.
- `FullDeal` interface extended with `seller_penalties: FullDealSellerPenalty[]`; both `GET /admin/full-deals` and `GET /admin/full-deal/:dealId` now fetch and join penalties from Replit Postgres (6th parallel query alongside disputes).

**Part #9 — Shipping Fee in Dispute** (bootstrap only — `shipping_fee_disputes` table)
- `shipping_fee_disputes` table in Replit Postgres (pg-pool.ts bootstrap), auto-created at startup:
  - `id UUID PK`, `deal_id TEXT`, `submitted_by UUID`, `party TEXT CHECK IN ('buyer','seller')`, `proof_url TEXT`, `comment TEXT`, `created_at TIMESTAMPTZ`
  - UNIQUE constraint on `(deal_id, submitted_by)` — one dispute per participant per deal.
  - Indexes on `deal_id` and `submitted_by`.
- `POST /api/shipping-fee-dispute` — JSON body `{deal_id, party, comment?, proof_url?}`:
  - Requires `payment_status = 'secured'`. Only buyer or seller of the deal may create.
  - Upserts on conflict (re-submit updates existing row). Returns `{dispute}`.
  - Notifies other party via `shipping_fee_dispute_created` push + in-app notification (non-fatal).
- `GET /api/shipping-fee-dispute/:dealId` — returns all disputes for the deal (buyer, seller, or admin).
- `GET /api/admin/shipping-fee-disputes` — lists all disputes with joined transaction metadata (admin-only).
- Notification type `"shipping_fee_dispute_created"` added to `NotificationType` union + `PUSH_ENABLED` set in `notifications.ts`.
- Migration `049_shipping_fee_disputes.sql` extends the Supabase `notifications.type` CHECK constraint.
- UI (buyer + seller): orange-accented "نزاع رسوم الشحن" card in `secure-deal-pay.tsx` between delivery proof and rating cards.
  - Visible when `dealStatus !== "awaiting_payment"` (payment secured or later).
  - Party selector (buyer/seller responsible), optional comment textarea, optional proof URL input.
  - Shows read-only list of all disputes submitted for the deal by either party.
  - Re-submitting updates existing dispute (upsert). Notified via success/error banners.
- UI (admin): collapsible orange-accented "نزاعات رسوم الشحن" panel in `SecureDeals.tsx` after the shipment proofs panel.
  - Table showing deal ID, product, price, responsible party badge, comment, proof URL link, date.
  - Also rendered inside `FullDealExpandedRow` as a `SubSection` (only when disputes exist for that deal).
- Client helpers: `createShippingFeeDispute()` and `getShippingFeeDisputes()` in `transactions.ts`.
- Admin helpers: `adminGetShippingFeeDisputes()` + `AdminShippingFeeDispute` / `FullDealShippingFeeDispute` types in `admin-api.ts`.
- `FullDeal` interface extended with `shipping_fee_disputes: FullDealShippingFeeDispute[]`; both `GET /admin/full-deals` and `GET /admin/full-deal/:dealId` now fetch and join disputes from Replit Postgres.

## System Design Choices

-   **API Server:** Express 5 handles all API requests.
-   **Frontend:** React with Vite and Tailwind CSS v4 for the main user application and the admin panel.
-   **Database (primary):** PostgreSQL via Supabase cloud, with Drizzle ORM for type-safe schema definitions and interactions.
-   **Database (transactions):** Replit-managed PostgreSQL (`DATABASE_URL`) for the `transactions` table, accessed via `pg` Pool in `api-server/src/lib/pg-pool.ts`.
-   **Validation:** Zod is used for data validation.
-   **Media Storage:** Cloudflare R2 for storing auction media (videos, thumbnails).
-   **Scheduled Jobs:** Background jobs manage media lifecycle (deleting expired media) and incomplete profile cleanup.

# External Dependencies

-   **Supabase:** Provides PostgreSQL database, authentication services (email/password, Google OAuth), and object storage (Supabase Storage for media during initial upload before processing).
-   **Cloudflare R2:** Primary object storage for processed auction media (videos and thumbnails).
-   **Firebase:** Utilized for Firebase Cloud Messaging (FCM) to send push notifications.
-   **Media3 Transformer (Android):** `androidx.media3:media3-transformer:1.4.1` for client-side video compression on Android.
-   **Express.js:** Node.js web application framework for the API server.
-   **React:** JavaScript library for building user interfaces.
-   **Vite:** Next-generation frontend tooling for fast development.
-   **Tailwind CSS:** Utility-first CSS framework for styling.
-   **TypeScript:** Superset of JavaScript for type-safe development.
-   **Drizzle ORM:** TypeScript ORM for interacting with the PostgreSQL database.
-   **Zod:** TypeScript-first schema declaration and validation library.
-   **pnpm:** Fast, disk space efficient package manager for monorepos.
-   **FFmpeg (server-side):** Used for server-side video transcoding and thumbnail extraction (implicitly, as part of the media processing pipeline).