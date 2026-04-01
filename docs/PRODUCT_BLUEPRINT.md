# BidReel — Product Blueprint
**Senior Mobile Product Engineering Reference**
*MVP scope · Mobile-first · React-based · Supabase backend*

---

## 1. Main App Structure

The app is a single-user-type mobile client with four top-level areas:

| Area | Purpose |
|---|---|
| **Feed** | Vertical short-video auction browser (primary surface) |
| **Create** | Auction creation wizard (gated to authenticated users) |
| **Notifications** | Outbid alerts, auction ending soon, new bids on your listings |
| **Profile** | Personal profile, active/ended auctions, bid history |

Authentication gate sits before all areas except the feed (which is browse-only for guests). A guest viewing any protected action (bid, like, create, report) is prompted to sign in.

---

## 2. Full Screen Map

```
App
├── Auth
│   ├── Welcome                 — Logo, tagline, "Get Started" CTA
│   ├── Phone Entry             — E.164 phone input, country picker
│   └── OTP Verification        — 6-digit code, resend timer
│
├── Feed (Tab 1)
│   ├── Feed (fullscreen)       — Vertical paged video cards
│   └── Auction Detail          — Slide-up from feed card tap
│       ├── Bid Sheet           — Slide-up bottom sheet
│       └── Contact Sheet       — WhatsApp deep-link slide-up
│
├── Create (Tab 2 / FAB)
│   ├── Media Picker            — Camera roll or live record
│   ├── Auction Form            — Title, description, category, start price, increment
│   └── Preview + Publish       — Final review before publishing
│
├── Notifications (Tab 3)
│   └── Notification List       — Outbid, ending soon, new bid
│
├── Profile (Tab 4)
│   ├── Own Profile             — Avatar, display name, bio, stats
│   │   ├── My Auctions tab     — Active listings
│   │   ├── My Bids tab         — Auctions user has bid on
│   │   └── Settings            — Display name, avatar, phone (read-only), logout
│   └── Other User Profile      — Public view, block/report actions
│
├── Modals / Sheets (global)
│   ├── Report Sheet            — Report reason + optional details
│   ├── Block Confirm Dialog    — "Block this user?" confirmation
│   └── Error Toast / Snackbar  — Network, validation, auth errors
│
└── Admin (separate web dashboard — not in mobile app)
    ├── Report Queue            — Pending reports list
    ├── Auction Detail (admin)  — Remove listing, view bids
    └── User Detail (admin)     — Ban/unban, audit log
```

---

## 3. Navigation Flow

**Bottom tab bar** (4 tabs): Feed · Create · Notifications · Profile

- Feed is the default landing screen after auth
- Create opens as a modal stack (full-screen take-over) not a tab page, so the tab bar disappears during creation
- The FAB (+) on the Feed screen can also trigger Create
- Auction Detail slides up from the feed card (shared element or slide-up sheet), not a full navigation push — this keeps the feed alive underneath and allows the user to swipe back to continue browsing
- Bid Sheet and Contact Sheet are bottom sheets over Auction Detail
- Deep links (e.g. push notification → specific auction) push Auction Detail on top of whichever tab is active

**Auth gate flow:**
```
Guest taps "Bid" → Login prompt bottom sheet → Phone Entry → OTP → 
dismissed back to same Auction Detail → Bid Sheet opens
```

**Back navigation:**
- Auction Detail → swipe down or back gesture → Feed resumes at same position
- Create flow → X button top-right → discard confirmation dialog if media/data was entered
- Settings → back arrow → Profile

---

## 4. Core User Journeys

### Journey A — New user, first auction bid
1. Opens app → Feed loads (no auth required to browse)
2. Scrolls feed, video auto-plays → taps card
3. Auction Detail opens → sees current bid, time remaining
4. Taps "Place Bid" → Auth gate appears
5. Enters phone → receives OTP → verifies
6. Bid Sheet opens with minimum bid pre-filled
7. Confirms bid → success state with updated price
8. Receives outbid notification later (if outbid)

### Journey B — Seller creates auction
1. Taps FAB or Create tab
2. Picks video from camera roll (max 60s, max 100MB)
3. Picks thumbnail image (auto-suggested from video frame, or manual pick)
4. Fills form: title, category, start price, min increment, description (optional)
5. Preview screen: reviews video + details
6. Taps "Publish" → auction live, redirect to own profile → auction card visible
7. Receives notification when first bid arrives

### Journey C — Winner contacts seller
1. Auction ends → winner receives notification ("You won! Contact seller to arrange delivery")
2. Opens notification → Auction Detail with "Contact Seller" CTA visible
3. Taps "Contact Seller" → server generates `wa.me` link server-side
4. WhatsApp opens with seller's number pre-dialed (phone never shown in app)
5. Seller also notified ("Your item sold — buyer will contact you on WhatsApp")

### Journey D — User reports a listing
1. On feed or Auction Detail → taps ⋮ menu
2. Selects "Report" → Report Sheet appears
3. Picks reason (spam, offensive, prohibited item, other), optional note
4. Submits → "Thank you, we'll review this" confirmation
5. Report enters moderation queue (admin reviews async)

---

## 5. Feed Behavior

**Layout:** Full-screen paged vertical scroll. One auction per screen. No scroll inertia mid-card — snap to next card.

**Video playback:**
- Auto-plays muted when card is in view (IntersectionObserver / Flatlist onViewableItemsChanged)
- Loops continuously until user swipes
- Pauses when app goes to background
- Sound toggle button top-right of card (state persists per session)

**Card overlay (on top of video):**
- Bottom: Title, current bid, time remaining, like count
- Right side: Like button, Share (copy link), ⋮ (report/block)
- Top-left: Seller avatar + name (tappable → profile)
- Top-right: Sound toggle

**Feed data:**
- Cursor-paginated (not offset) — safe for real-time inserts
- Active auctions only, ordered by `ends_at ASC` (ending soonest first)
- Excludes auctions from blocked users
- Pre-fetches next 2 cards ahead
- On pull-to-refresh: re-fetches from top

**Realtime:**
- `current_bid` and `bid_count` on visible card update live via Supabase Realtime
- Time remaining ticks down with a local interval timer (not server-polled)

**Empty state:** "No active auctions right now. Check back soon!" with an illustration.

**Error state:** "Couldn't load feed. Tap to retry." with retry CTA.

---

## 6. Auction Creation Flow

**Step 1 — Media picker**
- Video: camera roll or record in-app (max 60s, max 100MB, MP4/MOV)
- Thumbnail: auto-extracted from video frame 0 + frame selector strip, or manual pick from camera roll
- Both required before advancing
- Shows upload progress bar during upload to Supabase Storage
- Video transcoding note: in MVP, store as-is; add transcoding in phase 2

**Step 2 — Auction details form**
```
Title*          text input, 3–80 chars
Description     textarea, optional, 500 chars max
Category*       dropdown: electronics / fashion / collectibles / etc.
Start Price*    number input, > 0 (stored as integer cents)
Min Increment*  number input, default $10, > 0
```
- All validation client-side first, server confirms on submit
- Title is shown in feed card, so character count hint is displayed

**Step 3 — Preview + publish**
- Full-screen preview of the video card as it will appear in the feed
- Shows title, start price, category badge
- "Publish Auction" CTA
- Tapping publishes → `POST /api/auctions` with `videoUrl`, `thumbnailUrl`, form fields
- `ends_at` set server-side to `now + 3 days` (client does not control this)
- On success: navigate to own profile → My Auctions tab

**Cancellation:** X button at any step shows "Discard this auction?" dialog if media was selected.

---

## 7. Auction Detail Flow

Opened from feed card tap. Rendered as a slide-up bottom sheet (70% of screen height) over the still-playing feed video, OR as a full-screen push for deep-link arrivals.

**Content:**
```
Video (looping, top half)
Title
Seller row: avatar · name · "Follow" placeholder (phase 2)
Category badge
Current bid (large, bold, neon purple)
Time remaining: "2d 14h 32m" — ticks locally
Bid count: "23 bids"
─────────────────────────────
Bid History section (collapsed by default, expand chevron)
  Top 5 bids shown: amount · bidder avatar · time ago
─────────────────────────────
[Place Bid]             CTA button (disabled if auction ended)
[Contact Seller]        only visible if current user is the winner and auction ended
[Like]                  toggleable, shows count
[Share]                 copies deep link to clipboard
```

**State variants:**
| State | CTA shown |
|---|---|
| Active, not bid by user | "Place Bid" |
| Active, user is current leader | "You're winning — bid again" (disabled unless outbid) |
| Active, user is seller | "Your auction" — no bid CTA |
| Ended, user is winner | "Contact Seller" |
| Ended, user is not winner | "Auction ended" (greyed) |
| Ended, user is seller | "View Winner" (shows first name + avatar of winner) |

---

## 8. Bidding Interaction Flow

**Trigger:** Tap "Place Bid" on Auction Detail.

**Bid Sheet (bottom sheet):**
```
Current bid:   $120
Minimum bid:   $130  ← pre-filled in input
[     $130     ]     ← number input
[  Place Bid   ]     ← primary CTA
```

**Client-side validation (immediate, before API call):**
- Amount ≥ current_bid + min_increment
- Amount is a positive integer

**Server-side validation (authoritative):**
- Auction must be active (`ends_at > now()`)
- Bidder must not be the seller
- Amount must exceed current_bid + min_increment (race condition protection)

**Success flow:**
1. API responds 201
2. Sheet closes with a spring animation
3. Auction Detail `current_bid` updates (also via Realtime for other viewers)
4. "You're winning!" micro-animation on bid count badge

**Failure flows:**
| Error code | User-facing message |
|---|---|
| `AUCTION_NOT_ACTIVE` | "This auction has already ended" |
| `SELLER_CANNOT_BID` | "You can't bid on your own auction" |
| `BID_TOO_LOW` | "Minimum bid is $X. Your bid was too low." |
| `INVALID_TOKEN` | "Session expired. Please log in again." |
| Network error | "Couldn't place bid. Check your connection and try again." |

**Outbid notification:**
- Previous leader receives push notification: "You've been outbid on [Title]. Current price: $X"
- Tapping opens Auction Detail with Bid Sheet pre-opened

---

## 9. WhatsApp Contact Flow

**Principle:** Phone numbers are never stored in the API response or visible in the UI. The server generates the `wa.me` deep link using the seller's phone from the `profiles` table (service_role only access).

**Trigger:** Auction winner taps "Contact Seller" on ended Auction Detail.

**Flow:**
1. App calls `GET /api/auctions/:id/contact` with Bearer token
2. Server verifies caller is the auction winner (checks `auction_winners` table)
3. Server fetches seller's phone from `profiles` (internal, not returned in response)
4. Server builds `https://wa.me/<e164phone>?text=Hi, I won your auction for [Title]`
5. Server returns: `{ "url": "https://wa.me/..." }`
6. App calls `Linking.openURL(url)` → WhatsApp opens with seller pre-dialed
7. Server logs a `contact_requests` row for audit/moderation purposes

**Edge cases:**
- Caller is not the winner → `403 NOT_WINNER`
- Auction has not ended → `409 AUCTION_STILL_ACTIVE`
- Seller has no phone on file → `500` (shouldn't happen; phone is required at registration)
- WhatsApp not installed → opens `wa.me` in browser (web.whatsapp.com fallback)

---

## 10. Profile Structure

**Own profile:**
```
Header:   Avatar (tappable to change) · Display name · Edit pencil icon
Stats:    [Active Auctions] [Total Bids Received] [Liked]
Tabs:     [My Auctions] [My Bids] [Liked]  ← swipeable
Body:     Grid of auction cards (2-col), or list depending on context
```

**My Auctions tab:**
- Shows active + ended auctions (user's own listings)
- Each card: thumbnail, title, current bid, status badge (Active / Ended / Winner declared)
- Tap → Auction Detail (readonly for seller)

**My Bids tab:**
- Auctions the user has placed at least one bid on
- Status: "Winning" (current leader) · "Outbid" (not leader) · "Won" · "Lost"
- Ordered by `ends_at ASC` (most urgent first)

**Liked tab:**
- Auctions the user has liked
- Same card style, tap → Auction Detail

**Settings (accessed from profile header gear icon):**
```
Display Name    editable
Avatar          tap to change (uploads to Supabase Storage)
Phone number    read-only (used for login only)
Notifications   toggle
Log out         destructive action, confirm dialog
```

**Other user profile (public view):**
```
Header:   Avatar · Display name · [Block] [Report] (⋮ menu)
Stats:    Active Auctions count only
Tab:      [Active Auctions] only (no bids/likes tab — private data)
```
- No follow/unfollow in MVP (phase 2)

---

## 11. Likes Behavior

**Interaction model:**
- Heart button on feed card overlay and Auction Detail
- Toggle: tap once to like, tap again to unlike
- Optimistic update: UI updates immediately, rolls back on API error
- Like count visible to all users (not who liked)

**API design:**
- `POST /api/auctions/:id/like` — idempotent (duplicate like = no-op, not an error)
- `DELETE /api/auctions/:id/like` — idempotent (unlike non-liked = no-op)
- `like_count` on auction is a denormalized counter maintained by DB trigger

**Rules:**
- Sellers can like their own auctions (harmless vanity)
- Guests cannot like (auth gate prompt)
- No notification to seller when liked (phase 2)

**Edge cases:**
- Network failure → optimistic rollback + toast "Couldn't save like"
- Auction ended → liking still allowed (it's informational)

---

## 12. Reporting and Blocking Flow

### Reporting

**Trigger:** ⋮ menu on feed card or Auction Detail → "Report"

**Report Sheet:**
```
"Report this listing"
○ Spam or fake
○ Offensive content
○ Prohibited item
○ Other
[Optional: add details...]          — textarea, 500 chars max
[Submit Report]
```

**Rules:**
- One report per (user, auction) pair — duplicate silently accepted client-side, API returns 409 which the client ignores (user sees "Thanks" regardless)
- Reporter cannot be the seller
- Submitting a report does NOT immediately remove content (admin reviews first)
- Response: "Thanks for letting us know. We'll review this shortly."

### Blocking

**Trigger:** ⋮ menu on any feed card, Auction Detail, or other user's profile → "Block [Username]"

**Confirmation dialog:**
```
"Block [Username]?"
"Their listings will be hidden from your feed.
You won't see each other's activity."
[Cancel]   [Block]
```

**Effects (client + server):**
- `POST /api/blocks` inserts a block row
- Feed immediately filters out blocked seller's cards (client removes from local state)
- All subsequent feed loads exclude blocked sellers (`seller_id NOT IN blocked_ids`)
- Blocking is one-directional: A blocks B, B still sees A (unless B also blocks A)

**Unblocking:** Profile → Settings → Blocked Users list → Unblock (phase 2 nicety, but table supports it from day one).

---

## 13. Admin / Dashboard Structure

**Delivered as:** A separate web app (`/admin` path or separate domain), not part of the mobile app. Access gated by `is_admin = true` on the profile + admin session.

**Moderation Queue screen:**
```
Filters: [All] [Pending] [Actioned] [Dismissed]
List:    Report reason · Auction title · Reporter · Reported at · Status
```
Each item → opens Report Detail:
```
Auction preview (thumbnail + title + current bid)
Report: reason, details, reporter
Actions:
  [Remove Auction]    → sets auction.status = 'removed', notifies seller
  [Dismiss Report]    → marks report dismissed, no action on auction
  [Ban User]          → sets profiles.is_banned = true, ends all active auctions
```

**User Detail screen (admin):**
```
Profile info
Active auctions count
Reports filed count / reports received count
Actions: [Ban] [Unban] [View Auctions]
Ban reason input (required for ban action)
```

**Audit log:** Every admin action is appended to `admin_actions` (admin_id, action_type, target_id, target_type, note, created_at). Immutable.

**Dashboard home:**
```
Stats: Active auctions · Total bids today · Pending reports · Banned users
Recent activity: last 10 admin actions
```

---

## 14. Edge Cases and Failure Cases

### Auction lifecycle
| Case | Behavior |
|---|---|
| Auction ends with 0 bids | Status → 'ended', no winner record created |
| Auction ends with bids | Status → 'ended', `auction_winners` row inserted for highest bidder |
| Seller account banned mid-auction | Auction status → 'removed', active bids stand but no new bids accepted, notify active bidders |
| Two bids submitted simultaneously | Server uses DB-level check on `current_bid`; second bid fails with `BID_TOO_LOW` if amount is identical |
| User bids then immediately gets outbid before response arrives | Server validates at insert time; response returns the current state |

### Media
| Case | Behavior |
|---|---|
| Video upload fails mid-way | Client shows retry CTA; no auction record created (media-first, then form submit) |
| Video too large (>100MB) | Client-side guard before upload begins |
| Unsupported format | Client rejects before upload; server also validates MIME type |
| Supabase Storage down | Upload fails with "Couldn't upload media. Try again." |
| Seller deletes account after video is live | Auction remains visible until ended; media lifecycle job cleans up after retention window |

### Auth
| Case | Behavior |
|---|---|
| OTP expires | "Code expired. Request a new one." with resend CTA (enabled after 60s) |
| Wrong OTP 3× | "Too many attempts. Please request a new code." |
| Token expired mid-session | Silent refresh attempt; if refresh fails → redirect to login, preserve deep link |
| Phone changed (Supabase admin action) | User must re-authenticate; old tokens invalidated |

### Network
| Case | Behavior |
|---|---|
| No connection on app open | Offline banner; feed shows cached last-load if available |
| Connection drops during bid | Bid sheet shows loading state; timeout after 10s → error toast with retry |
| Realtime subscription drops | Silently reconnects; falls back to polling current auction on refocus |

---

## 15. Recommended Technical Architecture (Mobile-First React)

### Decision: React Native (Expo) over React web

For a TikTok-style experience with native video performance, haptics, push notifications, and camera access, **React Native via Expo** is the correct call. A React web PWA cannot match the feed smoothness or camera UX that this product requires.

### Frontend: Expo (React Native)
```
Expo SDK 51+ (managed workflow)
expo-av                    — video playback
expo-image-picker          — camera roll + recording
expo-camera                — in-app recording (phase 2)
expo-notifications         — push notifications
expo-linking               — deep links + WhatsApp Linking.openURL
@tanstack/react-query      — server state, caching, optimistic updates
zustand                    — lightweight client state (auth, feed position)
react-native-reanimated    — feed snap animations, sheet transitions
react-native-gesture-handler — swipe gestures
@gorhom/bottom-sheet       — Bid Sheet, Contact Sheet, Report Sheet
react-navigation v6        — tab + stack + modal navigation
nativewind (tailwind)      — styling
```

### Backend: Express + Supabase (already in place)
```
Node.js + Express 5        — API server (artifacts/api-server)
Supabase Auth              — Phone OTP + JWT
Supabase Storage           — Video + thumbnail files
Supabase Realtime          — Live bid updates on auction detail
Supabase PostgreSQL        — Primary database
Pino                       — Structured logging
Zod                        — Request/response validation
```

### Architecture diagram
```
Mobile App (Expo RN)
    │
    ├── Supabase Realtime  ← Live bid price updates (direct WebSocket)
    │
    └── BidReel API (Express)
            │
            ├── Supabase Auth   ← Token validation
            ├── Supabase DB     ← All reads/writes (service_role)
            └── Supabase Storage ← Presigned upload URLs
```

### Media upload strategy
1. Mobile app requests a presigned upload URL from the API: `POST /api/media/upload-url`
2. API generates a Supabase Storage signed URL (server-side, scoped to the user's folder)
3. App uploads video directly to Supabase Storage using the signed URL (bypasses Express — avoids memory pressure)
4. After upload, app receives the public/signed media URL
5. App submits auction form with the media URLs included

### Push notifications
- Use Expo Push Notification service (wraps APNs + FCM)
- Store `expo_push_token` on the `profiles` table
- API server sends push via Expo's HTTP API on: outbid event, auction ending soon (24h before), auction won, new bid on seller's listing

---

## 16. Suggested Folder Structure

### Mobile App (Expo)
```
artifacts/bidreel-mobile/       (or apps/mobile/)
├── app/                        expo-router file-based routing
│   ├── (auth)/
│   │   ├── welcome.tsx
│   │   ├── phone.tsx
│   │   └── otp.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx         bottom tab navigator
│   │   ├── index.tsx           feed
│   │   ├── create/
│   │   │   ├── media.tsx
│   │   │   ├── form.tsx
│   │   │   └── preview.tsx
│   │   ├── notifications.tsx
│   │   └── profile/
│   │       ├── index.tsx       own profile
│   │       └── [userId].tsx    other user profile
│   └── auction/
│       └── [id].tsx            deep-link auction detail
│
├── components/
│   ├── feed/
│   │   ├── FeedCard.tsx        full-screen video card
│   │   ├── FeedList.tsx        paged FlashList
│   │   └── FeedOverlay.tsx     like/share/menu overlay
│   ├── auction/
│   │   ├── AuctionDetail.tsx
│   │   ├── BidSheet.tsx
│   │   ├── ContactSheet.tsx
│   │   └── BidHistory.tsx
│   ├── profile/
│   │   ├── ProfileHeader.tsx
│   │   └── AuctionGrid.tsx
│   ├── shared/
│   │   ├── Avatar.tsx
│   │   ├── Badge.tsx
│   │   ├── CountdownTimer.tsx
│   │   ├── PriceDisplay.tsx
│   │   └── BottomSheet.tsx     wrapper around @gorhom/bottom-sheet
│   └── modals/
│       ├── ReportSheet.tsx
│       └── BlockDialog.tsx
│
├── hooks/
│   ├── useFeed.ts              react-query: paginated feed
│   ├── useAuction.ts           react-query: single auction + realtime
│   ├── usePlaceBid.ts          react-query mutation
│   ├── useLike.ts              optimistic toggle mutation
│   ├── useAuth.ts              auth state from zustand + supabase
│   └── useCurrentUser.ts
│
├── store/
│   ├── auth.store.ts           zustand: user + token
│   └── feed.store.ts           zustand: scroll position, mute state
│
├── services/
│   ├── api.ts                  base fetch client with auth header injection
│   ├── auctions.api.ts
│   ├── bids.api.ts
│   ├── auth.api.ts
│   └── reports.api.ts
│
├── lib/
│   ├── supabase.ts             supabase-js client (anon key only)
│   ├── realtime.ts             Realtime channel helpers
│   └── push.ts                 Expo push token registration
│
├── constants/
│   ├── colors.ts               neon purple palette, dark theme tokens
│   └── layout.ts               screen dimensions, safe area helpers
│
└── utils/
    ├── formatCurrency.ts
    ├── formatTimeRemaining.ts
    └── validators.ts
```

### Backend (already in place at artifacts/api-server/)
```
src/
├── config/env.ts
├── routes/          auth, auctions, reports, notifications, admin
├── controllers/     (scaffolded — extract from routes as app grows)
├── services/        auctions, bids, auth, reports, blocks, winners
├── middlewares/     requireAuth
├── lib/             supabase, logger, profiles, notifications, media-lifecycle
└── utils/           response, validation, pagination
```

### Admin Dashboard (phase 1.5 — simple web app)
```
artifacts/admin-web/
├── pages/
│   ├── index.tsx       dashboard home (stats)
│   ├── reports.tsx     moderation queue
│   └── users.tsx       user search + ban management
├── components/
│   └── ...
└── lib/
    └── api.ts          calls same /api/admin/* endpoints
```

---

## 17. MVP Scope vs Later-Phase Features

### ✅ MVP (launch with this)

**Auth:** Phone OTP login only · Profile display name + avatar

**Feed:** Vertical paged feed · Video autoplay/loop · Like/unlike · Realtime bid price

**Auction:** Create with video + thumbnail · 3-day fixed duration · Category + start price + increment · Active/ended states

**Bidding:** Place bid with all 3 server-side validations · Outbid notification · Winner record on close

**Contact:** WhatsApp deep link (server-side, phone hidden) · `contact_requests` audit log

**Safety:** Report with reason · Block user · Moderation queue · Admin ban/remove

**Profile:** Own profile with My Auctions, My Bids, Liked tabs · Other user public profile · Settings with logout

**Notifications:** Push on outbid, auction won, new bid received (basic)

---

### 🔜 Phase 2 (post-launch, next 60–90 days)

| Feature | Rationale |
|---|---|
| Search / Explore | Users need discovery beyond chronological feed |
| Follow users | Social graph for personalized feed |
| Video transcoding | Normalize bitrate/resolution for consistent playback |
| Auction extend (last-minute bid rule) | Common auction mechanic — auto-extend 5min if bid in last 5min |
| Scheduled auction start | Sellers set start time, not just end time |
| Image-only listings | Lower friction for sellers without video |
| Push notification preferences | Granular control per type |
| Unblock user (UI) | `blocks` table already supports it, just needs UI |
| Deep link sharing | Share specific auction via link/social |
| Analytics for sellers | Views, bid history graph, conversion rate |

### 🔭 Phase 3 (scale features)

| Feature | Notes |
|---|---|
| Payment processing | Out of MVP scope entirely — add escrow/payment rails when ready |
| Commission engine | Revenue model — not in MVP by design |
| Verified seller badge | Trust signal |
| AI content moderation | Auto-flag before human review |
| Live auction (real-time bidding war) | Complex — requires WebSocket state machine |
| Multi-language / localization | After product-market fit |
| iOS + Android native push optimization | Expo handles MVP; revisit with bare workflow at scale |
| Admin mobile app | Web dashboard is fine until meaningful admin volume |

---

*Document version: MVP 1.0 · Last updated: 2026-04*
