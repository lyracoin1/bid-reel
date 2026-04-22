import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Supabase JS does not expose raw SQL execution, so we use the Postgres REST
// extension via fetch + the service-role JWT (the conventional pattern).
const url = new URL("/rest/v1/rpc/exec_sql", process.env.SUPABASE_URL).toString();

async function tryExecRpc(sql) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": "public",
    },
    body: JSON.stringify({ sql }),
  });
  return { status: r.status, body: await r.text() };
}

console.log("attempting exec_sql RPC…");
const probe = await tryExecRpc("SELECT 1");
console.log("probe:", probe.status, probe.body.slice(0, 200));
