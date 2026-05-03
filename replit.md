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
- **Parts:** Includes features for buyer conditions, seller conditions, deal ratings, buyer payment proof upload, seller shipment proof upload + tracking link, seller penalty system, and shipping fee dispute system. All these features involve specific API endpoints, database migrations, and UI components for both users and admins, with relevant notifications.

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