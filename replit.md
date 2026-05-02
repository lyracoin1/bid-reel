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