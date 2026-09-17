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
  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
  const fullName = typeof fields.fullName === "string" ? fields.fullName.trim() : "";
  const role = fields.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || fullName.length > 120 || (role !== "manager" && role !== "staff")) {
    return reply(400, { error: "Enter a valid email, name, and role." });
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (inviteError || !invited.user) return reply(400, { error: inviteError?.message ?? "Could not invite user." });

  const { error: profileError } = await admin.from("profiles").upsert({
    id: invited.user.id,
    role,
    full_name: fullName,
  }, { onConflict: "id" });
  if (profileError) {
    console.error("Could not assign invited user role", profileError);
    return reply(500, { error: "Invitation was sent, but role assignment failed. Check the user's profile in Supabase before retrying." });
  }
  return reply(200, { id: invited.user.id });
});
