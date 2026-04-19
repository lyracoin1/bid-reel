import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || "https://" + (process.env.SUPABASE_PROJECT_REF || "") + ".supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("no SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
// Read URL from .env if needed
import fs from "fs";
let supaUrl = process.env.SUPABASE_URL;
if (!supaUrl) {
  for (const p of [".env", "artifacts/api-server/.env", ".env.local"]) {
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, "utf8").match(/^SUPABASE_URL\s*=\s*(.+)$/m);
      if (m) { supaUrl = m[1].trim().replace(/^["']|["']$/g, ""); break; }
    }
  }
}
console.log("URL:", supaUrl);
const sb = createClient(supaUrl, key, { auth: { persistSession: false } });

console.log("\n--- 1. auction_deals readable ---");
let r = await sb.from("auction_deals").select("id, auction_id, seller_id, buyer_id, status, seller_confirmation, buyer_confirmation, winning_amount").limit(5);
console.log(r.error ? "ERR: " + r.error.message : "rows:" + (r.data?.length ?? 0), r.data?.[0] || "");

console.log("\n--- 2. deal_ratings readable ---");
r = await sb.from("deal_ratings").select("id, deal_id, role, score").limit(5);
console.log(r.error ? "ERR: " + r.error.message : "rows:" + (r.data?.length ?? 0));

console.log("\n--- 3. user_trust_stats view readable ---");
r = await sb.from("user_trust_stats").select("user_id, completed_sales, total_sell_deals, seller_completion_rate, final_seller_score, number_of_completed_deals").limit(5);
console.log(r.error ? "ERR: " + r.error.message : "rows:" + (r.data?.length ?? 0), r.data?.[0] || "");

console.log("\n--- 4. recompute_deal_status RPC reachable (expects null for fake id) ---");
r = await sb.rpc("recompute_deal_status", { p_deal_id: "00000000-0000-0000-0000-000000000000" });
console.log(r.error ? "ERR(expected if not found): " + r.error.message : "data:", JSON.stringify(r.data));

console.log("\n--- 5. trigger exists ---");
r = await sb.rpc("pg_get_triggerdef", { trigger_oid: 0 }).then(()=>null,()=>null); // skip; check via select
const { data: trig, error: trigErr } = await sb.from("pg_trigger").select("tgname").eq("tgname", "trg_create_deal_on_auction_end");
console.log(trigErr ? "trig query err: " + trigErr.message : "trigger rows: " + (trig?.length ?? 0));

console.log("\n--- 6. count of ended auctions vs auction_deals (backfill check) ---");
const { count: endedCount } = await sb.from("auctions").select("*", { count: "exact", head: true }).in("status", ["ended","archived"]).not("winner_id","is",null);
const { count: dealsCount } = await sb.from("auction_deals").select("*", { count: "exact", head: true });
console.log("ended-with-winner auctions:", endedCount, " | auction_deals rows:", dealsCount);

console.log("\n--- 7. sample existing user trust ---");
const { data: anyProfile } = await sb.from("profiles").select("id").limit(1).maybeSingle();
if (anyProfile) {
  const t = await sb.from("user_trust_stats").select("*").eq("user_id", anyProfile.id).maybeSingle();
  console.log("user", anyProfile.id, t.error ? "ERR: " + t.error.message : t.data);
}
