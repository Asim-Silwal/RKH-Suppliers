import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: "Server is not configured." });
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return reply(401, { error: "Sign in required." });

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return reply(401, { error: "Invalid session." });
  const { data: owner, error: ownerError } = await admin
    .from("app_owner").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (ownerError || !owner) return reply(403, { error: "Owner access required." });

  let input: unknown;
  try { input = await request.json(); } catch { return reply(400, { error: "Invalid request." }); }
  if (!input || typeof input !== "object") return reply(400, { error: "Invalid request." });
  const fields = input as Record<string, unknown>;
  const userId = typeof fields.userId === "string" ? fields.userId : "";
  const password = typeof fields.password === "string" ? fields.password : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || password.length < 12 || password.length > 128) {
    return reply(400, { error: "Choose a user and enter a password of 12 to 128 characters." });
  }

  const { data: target, error: targetError } = await admin.from("profiles")
    .select("id").eq("id", userId).maybeSingle();
  if (targetError || !target) return reply(404, { error: "User not found." });
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateError) return reply(400, { error: updateError.message });
  return reply(200, { updated: true });
});
