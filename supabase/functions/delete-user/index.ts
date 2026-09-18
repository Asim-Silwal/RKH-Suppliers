import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: "Server is not configured." });
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return reply(401, { error: "Sign in required." });
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData.user) return reply(401, { error: "Invalid session." });
  const { data: owner, error: ownerError } = await admin.from("app_owner")
    .select("user_id").eq("user_id", callerData.user.id).maybeSingle();
  if (ownerError || !owner) return reply(403, { error: "Owner access required." });

  let input: unknown;
  try { input = await request.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const userId = input && typeof input === "object" && "userId" in input && typeof input.userId === "string" ? input.userId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply(400, { error: "Choose a valid user." });
  if (userId === callerData.user.id) return reply(400, { error: "The account owner cannot be deleted." });

  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id, full_name").eq("id", userId).maybeSingle();
  if (profileError || !profile) return reply(404, { error: "User not found." });
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
  if (targetError || !target.user) return reply(404, { error: "Auth user not found." });
  const displayName = profile.full_name?.trim() || target.user.email || "Former user";
  const { error: snapshotError } = await admin.from("cooperative_entries")
    .update({ recorded_by_name: displayName }).eq("recorded_by", userId);
  if (snapshotError) return reply(500, { error: "Could not preserve the user's Sahakari history." });

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return reply(400, { error: deleteError.message });
  return reply(200, { deleted: true });
});
