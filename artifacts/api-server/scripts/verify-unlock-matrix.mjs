// Full buyer-side $1 unlock verification matrix.
// Creates 3 users (seller S, buyer X, buyer Y), 2 auctions (A, B) + 1 fixed
// listing (F), and runs all 8 scenarios from the user's checklist with HTTP-
// level evidence. Uses Supabase admin to provision users; calls the live
// api-server on localhost:8080 for everything else.

const API = "http://localhost:8080/api";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;

const stamp = Date.now();
const users = {
  seller: { email: `seller-${stamp}@verify.local`, password: "TestPass!9!9" },
  buyerX: { email: `buyerx-${stamp}@verify.local`, password: "TestPass!9!9" },
  buyerY: { email: `buyery-${stamp}@verify.local`, password: "TestPass!9!9" },
};

const fmt = (s) => s.replace(/\s+/g, " ").slice(0, 220);
const checks = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? "  — " + fmt(detail) : ""}`);
}

async function adminCreateUser(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { "apikey": SR, "Authorization": `Bearer ${SR}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`createUser ${email} → ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`signIn ${email} → ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function ensureProfile(uid, phone) {
  // The api-server's onboarding flow normally creates the profile. We can
  // just upsert directly with service role for the test.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: uid,
      username: `vfy${uid.slice(0, 8)}`,
      display_name: "Verify User",
      phone,
    }),
  });
  if (!r.ok && r.status !== 409) {
    console.warn(`profile upsert ${uid} → ${r.status} ${await r.text()}`);
  }
}

async function api(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// Cleanup helper — runs even on error.
const created = { userIds: [], auctionIds: [] };
async function cleanup() {
  for (const aid of created.auctionIds) {
    await fetch(`${SUPABASE_URL}/rest/v1/auctions?id=eq.${aid}`, {
      method: "DELETE", headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    }).catch(() => {});
  }
  for (const uid of created.userIds) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "DELETE", headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    }).catch(() => {});
  }
}

try {
  console.log("\n══════ PROVISION ══════");
  const sellerId = await adminCreateUser(users.seller.email, users.seller.password);
  const buyerXId = await adminCreateUser(users.buyerX.email, users.buyerX.password);
  const buyerYId = await adminCreateUser(users.buyerY.email, users.buyerY.password);
  created.userIds.push(sellerId, buyerXId, buyerYId);
  await ensureProfile(sellerId, "+15555550001");
  await ensureProfile(buyerXId, "+15555550002");
  await ensureProfile(buyerYId, "+15555550003");
  const sellerJwt = await signIn(users.seller.email, users.seller.password);
  const xJwt      = await signIn(users.buyerX.email, users.buyerX.password);
  const yJwt      = await signIn(users.buyerY.email, users.buyerY.password);
  console.log(`  seller=${sellerId.slice(0, 8)}  buyerX=${buyerXId.slice(0, 8)}  buyerY=${buyerYId.slice(0, 8)}`);

  // Create A, B (auctions, 24h) + F (fixed-price) as the seller.
  const baseAuc = {
    description: "verify",
    category: "other",
    saleType: "auction",
    startPrice: 10,
    minIncrement: 1,
    videoUrl: `${SUPABASE_URL}/storage/v1/object/public/auction-media/${sellerId}/v.mp4`,
    thumbnailUrl: `${SUPABASE_URL}/storage/v1/object/public/auction-media/${sellerId}/t.jpg`,
    lat: 30.04, lng: 31.24,
    durationHours: 24,
  };
  let r = await api("POST", "/auctions", sellerJwt, { ...baseAuc, title: `verify-A-${stamp}` });
  if (r.status !== 201) throw new Error(`Create A failed: ${r.status} ${r.text}`);
  const aucA = r.json.auction.id; created.auctionIds.push(aucA);

  r = await api("POST", "/auctions", sellerJwt, { ...baseAuc, title: `verify-B-${stamp}` });
  if (r.status !== 201) throw new Error(`Create B failed: ${r.status} ${r.text}`);
  const aucB = r.json.auction.id; created.auctionIds.push(aucB);

  r = await api("POST", "/auctions", sellerJwt, {
    ...baseAuc, saleType: "fixed", fixedPrice: 50, title: `verify-F-${stamp}`,
  });
  if (r.status !== 201) throw new Error(`Create F failed: ${r.status} ${r.text}`);
  const fixedF = r.json.auction.id; created.auctionIds.push(fixedF);
  console.log(`  A=${aucA.slice(0,8)}  B=${aucB.slice(0,8)}  F=${fixedF.slice(0,8)}`);

  console.log("\n══════ MATRIX ══════");

  // ── 1. Unpaid buyer X cannot see seller contact on auction A ──────────
  r = await api("GET", `/auctions/${aucA}`, xJwt);
  check(
    "1. unpaid buyer X: GET A → seller.phone redacted, viewer_unlocked=false",
    r.status === 200
      && r.json?.auction?.seller?.phone === null
      && r.json?.auction?.viewer_unlocked === false,
    `status=${r.status} phone=${JSON.stringify(r.json?.auction?.seller?.phone)} viewer_unlocked=${r.json?.auction?.viewer_unlocked}`,
  );

  // ── 2. Unpaid buyer X cannot bid on auction A ─────────────────────────
  r = await api("POST", `/auctions/${aucA}/bids`, xJwt, { bid_increment: 5 });
  check(
    "2. unpaid buyer X: POST bid A → 402 AUCTION_NOT_UNLOCKED",
    r.status === 402 && r.json?.error === "AUCTION_NOT_UNLOCKED",
    `status=${r.status} error=${r.json?.error}`,
  );

  // ── 3. Buyer X unlocks auction A ──────────────────────────────────────
  r = await api("POST", `/auctions/${aucA}/unlock`, xJwt);
  check(
    "3a. buyer X: POST unlock A → 200 ok, alreadyUnlocked=false (fresh)",
    r.status === 200 && r.json?.ok === true && r.json?.alreadyUnlocked === false,
    `status=${r.status} alreadyUnlocked=${r.json?.alreadyUnlocked}`,
  );

  // 3b. Idempotent re-unlock
  r = await api("POST", `/auctions/${aucA}/unlock`, xJwt);
  check(
    "3b. buyer X: POST unlock A again → 200 ok, alreadyUnlocked=true (idempotent)",
    r.status === 200 && r.json?.ok === true && r.json?.alreadyUnlocked === true,
    `status=${r.status} alreadyUnlocked=${r.json?.alreadyUnlocked}`,
  );

  // ── 4. Paid buyer X CAN see seller contact ────────────────────────────
  r = await api("GET", `/auctions/${aucA}`, xJwt);
  check(
    "4. paid buyer X: GET A → seller.phone visible, viewer_unlocked=true",
    r.status === 200
      && r.json?.auction?.seller?.phone === "+15555550001"
      && r.json?.auction?.viewer_unlocked === true,
    `status=${r.status} phone=${JSON.stringify(r.json?.auction?.seller?.phone)} viewer_unlocked=${r.json?.auction?.viewer_unlocked}`,
  );

  // ── 5. Paid buyer X CAN bid ───────────────────────────────────────────
  r = await api("POST", `/auctions/${aucA}/bids`, xJwt, { bid_increment: 5 });
  check(
    "5. paid buyer X: POST bid A → 201 (bid accepted, row created)",
    (r.status === 200 || r.status === 201) && r.json?.bid?.id != null,
    `status=${r.status} bid_id=${r.json?.bid?.id?.slice(0,8)} amount=${r.json?.bid?.amount}`,
  );

  // ── 6. Cross-auction isolation: buyer X unlocked A but NOT B ──────────
  const xOnB = await api("GET", `/auctions/${aucB}`, xJwt);
  const xBidB = await api("POST", `/auctions/${aucB}/bids`, xJwt, { bid_increment: 5 });
  check(
    "6a. cross-auction isolation: paid-on-A buyer X views B → still locked",
    xOnB.status === 200
      && xOnB.json?.auction?.seller?.phone === null
      && xOnB.json?.auction?.viewer_unlocked === false,
    `phone=${JSON.stringify(xOnB.json?.auction?.seller?.phone)} viewer_unlocked=${xOnB.json?.auction?.viewer_unlocked}`,
  );
  check(
    "6b. cross-auction isolation: paid-on-A buyer X bids on B → 402 AUCTION_NOT_UNLOCKED",
    xBidB.status === 402 && xBidB.json?.error === "AUCTION_NOT_UNLOCKED",
    `status=${xBidB.status} error=${xBidB.json?.error}`,
  );

  // ── 7. Cross-user isolation: buyer Y still locked on A even though X paid
  const yOnA = await api("GET", `/auctions/${aucA}`, yJwt);
  const yBidA = await api("POST", `/auctions/${aucA}/bids`, yJwt, { bid_increment: 5 });
  check(
    "7a. cross-user isolation: buyer Y views A (X paid) → Y still locked",
    yOnA.status === 200
      && yOnA.json?.auction?.seller?.phone === null
      && yOnA.json?.auction?.viewer_unlocked === false,
    `phone=${JSON.stringify(yOnA.json?.auction?.seller?.phone)} viewer_unlocked=${yOnA.json?.auction?.viewer_unlocked}`,
  );
  check(
    "7b. cross-user isolation: buyer Y bids on A → 402 AUCTION_NOT_UNLOCKED",
    yBidA.status === 402 && yBidA.json?.error === "AUCTION_NOT_UNLOCKED",
    `status=${yBidA.status} error=${yBidA.json?.error}`,
  );

  // ── 8. Seller never needs to pay for own auction ──────────────────────
  const sellerOnA = await api("GET", `/auctions/${aucA}`, sellerJwt);
  check(
    "8a. seller views own A → viewer_unlocked=true (no payment needed)",
    sellerOnA.status === 200 && sellerOnA.json?.auction?.viewer_unlocked === true,
    `viewer_unlocked=${sellerOnA.json?.auction?.viewer_unlocked}`,
  );
  const sellerUnlock = await api("POST", `/auctions/${aucA}/unlock`, sellerJwt);
  check(
    "8b. seller tries to unlock own A → 400 SELLER_CANNOT_UNLOCK_OWN",
    sellerUnlock.status === 400 && sellerUnlock.json?.error === "SELLER_CANNOT_UNLOCK_OWN",
    `status=${sellerUnlock.status} error=${sellerUnlock.json?.error}`,
  );

  // Bonus: /auctions/mine returns viewer_unlocked=true for all seller's listings
  const mine = await api("GET", "/auctions/mine", sellerJwt);
  const allMineUnlocked = mine.json?.auctions?.every((a) => a.viewer_unlocked === true);
  check(
    "8c. /auctions/mine → all rows viewer_unlocked=true (seller is always unlocked on own listings)",
    mine.status === 200 && allMineUnlocked === true,
    `count=${mine.json?.auctions?.length} all_unlocked=${allMineUnlocked}`,
  );

  // ── 9. Fixed-price F is free and unchanged ────────────────────────────
  const xOnF = await api("GET", `/auctions/${fixedF}`, xJwt);
  check(
    "9a. unpaid buyer X views fixed-price F → seller.phone visible, viewer_unlocked=true (no gate)",
    xOnF.status === 200
      && xOnF.json?.auction?.seller?.phone === "+15555550001"
      && xOnF.json?.auction?.viewer_unlocked === true
      && xOnF.json?.auction?.sale_type === "fixed",
    `phone=${JSON.stringify(xOnF.json?.auction?.seller?.phone)} viewer_unlocked=${xOnF.json?.auction?.viewer_unlocked} sale_type=${xOnF.json?.auction?.sale_type}`,
  );

  const anonOnF = await api("GET", `/auctions/${fixedF}`, null);
  check(
    "9b. anonymous viewer on fixed-price F → seller.phone visible, viewer_unlocked=true",
    anonOnF.status === 200
      && anonOnF.json?.auction?.seller?.phone === "+15555550001"
      && anonOnF.json?.auction?.viewer_unlocked === true,
    `phone=${JSON.stringify(anonOnF.json?.auction?.seller?.phone)} viewer_unlocked=${anonOnF.json?.auction?.viewer_unlocked}`,
  );

  const xUnlockF = await api("POST", `/auctions/${fixedF}/unlock`, xJwt);
  check(
    "9c. POST /unlock on fixed-price F → 400 FIXED_PRICE_NO_UNLOCK",
    xUnlockF.status === 400 && xUnlockF.json?.error === "FIXED_PRICE_NO_UNLOCK",
    `status=${xUnlockF.status} error=${xUnlockF.json?.error}`,
  );

  // Bonus: anonymous viewer on auction A → fail closed
  const anonOnA = await api("GET", `/auctions/${aucA}`, null);
  check(
    "10. anonymous viewer on auction A → seller.phone redacted, viewer_unlocked=false (fail-closed)",
    anonOnA.status === 200
      && anonOnA.json?.auction?.seller?.phone === null
      && anonOnA.json?.auction?.viewer_unlocked === false,
    `phone=${JSON.stringify(anonOnA.json?.auction?.seller?.phone)} viewer_unlocked=${anonOnA.json?.auction?.viewer_unlocked}`,
  );

  console.log("\n══════ SUMMARY ══════");
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log(`${passed}/${checks.length} passed.${failed ? "  FAILED: " + failed : "  All green."}`);
  if (failed) {
    console.log("\nFailures:");
    for (const c of checks.filter((x) => !x.ok)) console.log(`  ❌ ${c.label}  (${c.detail})`);
  }
  await cleanup();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error("\n💥", e.message);
  await cleanup();
  process.exit(2);
}
