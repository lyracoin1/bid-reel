# Replit Environment

## Running the App
- `pnpm install` — installs all workspace dependencies
- Workflow "Start application" runs all three services in parallel:
  - **bidreel-web** (frontend) on port 5000 — proxies `/api/*` to the API server
  - **api-server** (Express API) on port 8080
  - **bidreel-admin** (admin dashboard) on port 22020 at path `/bidreel-admin/`

## Required Secrets
- `SUPABASE_ANON_KEY` — Supabase anon/public key (set as Replit Secret)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (set as Replit Secret)
- Optional: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` — Cloudflare R2 storage
- Optional: `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase push notifications

## Replit-specific Notes
- `VITE_API_URL` is cleared in dev (Replit) mode so the Vite proxy handles `/api/*` locally instead of hitting the production URL
- `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` are injected by Replit for the native Postgres instance (used for Secure Deals transactions table)

# Overview

BidReel is a pnpm monorepo TypeScript project for a short-video Arabic auction mobile application. It allows users to upload video/image content for items, host auctions, and bid on items through a TikTok-style vertical feed. A key feature is direct WhatsApp contact for auction winners via server-generated deep-links, ensuring user privacy. The application features a dark theme with a neon purple accent and prioritizes a RTL/Arabic-first UI with English/Arabic language switching. The vision is to capture the online auction market in Arabic-speaking regions with an engaging, secure, and visually appealing video-centric marketplace.

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

The application utilizes a dark theme with a neon purple accent and is designed with an RTL/Arabic-first approach, supporting full Arabic localization alongside English. The primary interaction is a vertical, TikTok-style video feed.

## Technical Implementations

### Monorepo Structure
The project uses a pnpm workspace monorepo for shared dependencies and consistent tooling.

### Video Upload and Compression
All videos are compressed client-side before upload.
- **Android:** Uses a native Capacitor plugin with Media3 Transformer for H.264/AAC/MP4/720p re-encoding.
- **iOS & Web:** Video posting is currently disabled.

### Authentication
Authentication is email-first via Supabase email/password, with Google Sign-In as an OAuth option. Phone numbers are for contact only. New users go through an onboarding flow, while existing users access the main feed directly.

### Rule/Safety Notice Flow
Rules are presented at three points: after profile setup (onboarding), before the first auction publish, and before the first bid submission. Modals include "Confirm," "Skip," and a link to a full rules page, supporting `en/ar/ru/es/fr` with RTL for Arabic.

### Media Processing
After auction creation, a server-side process transcodes the video to 720p H.264/AAC, extracts a JPEG thumbnail, updates the auction record, and deletes the original file.

### Feed Intelligence Ranking
Authenticated users see auctions ranked by a weighted additive scoring model based on user signals, bidding history, saved auctions, followed sellers, and category preferences. Anonymous users see auctions by recency.

### Secure Deals (Transactions)
A peer-to-peer escrow-style feature for off-auction sales.
- **Workflow:** Seller creates a deal, generates a payment link. Buyer opens the link, confirms payment.
- **Data:** All transaction data is stored in a Replit PostgreSQL `transactions` table via the API server.
- **Authentication:** GET requests are public; POST/pay/ship require a Supabase JWT.
- **Payment Gateway:** Placeholder in `artifacts/api-server/src/routes/secure-deals.ts` to be replaced with Google Play Billing / Stripe.
- **Notifications:** Placeholders for FCM or Email.
- **Bootstrapping:** `transactions` table is automatically bootstrapped on API server startup.
- **Parts:** Includes features for buyer conditions, seller conditions, deal ratings, buyer payment proof upload, seller shipment proof upload + tracking link, seller penalty system, shipping fee dispute system, escrow logic (Part #12), external payment warning (Part #13), platform fee 3% (Part #14), and product media upload (Part #15). All these features involve specific API endpoints, database migrations, and UI components for both users and admins, with relevant notifications.
- **Part #15 — Product Media Upload:** Sellers can upload product images (JPEG/PNG/WebP, max 10 MB) and videos (MP4, max 50 MB) for any deal. Stored in R2 under `product-media/{sellerId}/{uuid}.{ext}`. Upserted on (deal_id, file_name). Both buyer and seller see a gallery on the deal page with a lightbox viewer. Admins see the media grid in the SecureDeals expanded row. A `product_media_uploaded` notification is sent to all admins on each upload.
- **Manual Payout System:** Platform holds buyer payments, takes 3% fee, and manually pays sellers. Two new tables: `seller_payout_methods` (AES-256-GCM encrypted account details, same VAULT_ENCRYPTION_KEY) and `payouts` (one per deal, UNIQUE on deal_id, status: ready→processing→paid or cancelled). Payout records are created automatically (idempotent, non-fatal) at three trigger points: buyer vault ACK (`digital-vault.ts`), admin resolves digital dispute in seller's favour (`digital-vault.ts`), and escrow release (`escrow.ts`). Admin endpoints: `GET/admin/payouts` (list+filter), `GET /admin/payouts/:id` (decrypt payout method + audit log `last_admin_view_at`), `POST /admin/payouts/:id/process|complete|cancel`. Seller endpoints: `GET /my/payout-methods` (CRUD, no decrypted data returned), `GET /my/payouts` (safe view). Service: `artifacts/api-server/src/services/payout.service.ts`. Routes: `artifacts/api-server/src/routes/payouts.ts` (before adminRouter in index.ts), `artifacts/api-server/src/routes/payout-methods.ts` (before notificationRouter).

## System Design Choices

-   **API Server:** Express 5.
-   **Frontend:** React with Vite and Tailwind CSS v4.
-   **Primary Database:** PostgreSQL via Supabase cloud with Drizzle ORM.
-   **Transactions Database:** Replit-managed PostgreSQL for `transactions` table, accessed via `pg` Pool.
-   **Validation:** Zod.
-   **Media Storage:** Cloudflare R2 for processed media.
-   **Scheduled Jobs:** Background jobs for media lifecycle and profile cleanup.
-   **Part #13 — External Payment Warning:** `POST /api/deal/external-payment-warning` route (buyer or seller flags a deal); 3 new idempotent columns on transactions (`external_payment_warning BOOLEAN`, `external_payment_confirmed_at TIMESTAMPTZ`, `external_payment_warning_reason TEXT`); admin notifications via `createNotification`; warning banner + disabled Pay Now button + "Report External Payment" inline form in `secure-deal-pay.tsx`; ⚠️ badge + filter dropdown + summary card + detail subsection in admin SecureDeals.tsx; `external_payment_warning` NotificationType in all notification registries + i18n for 6 languages.

# External Dependencies

-   **Supabase:** PostgreSQL database, authentication (email/password, Google OAuth), object storage (initial media upload).
-   **Cloudflare R2:** Primary object storage for processed auction media.
-   **Firebase:** Firebase Cloud Messaging (FCM) for push notifications.
-   **Media3 Transformer (Android):** `androidx.media3:media3-transformer:1.4.1` for client-side video compression.
-   **Express.js:** Node.js web application framework.
-   **React:** JavaScript library for UIs.
-   **Vite:** Frontend tooling.
-   **Tailwind CSS:** CSS framework.
-   **TypeScript:** Type-safe development.
-   **Drizzle ORM:** TypeScript ORM.
-   **Zod:** Schema declaration and validation.
-   **pnpm:** Package manager for monorepos.
-   **FFmpeg:** (Implicitly) for server-side video transcoding and thumbnail extraction.