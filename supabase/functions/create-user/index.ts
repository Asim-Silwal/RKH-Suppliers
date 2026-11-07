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

  const { data: caller, error: callerError } = await admin
    .from("profiles").select("active_business_id").eq("id", userData.user.id).maybeSingle();
  if (callerError || !caller?.active_business_id) return reply(403, { error: "Select a business workspace first." });
  const { data: membership, error: membershipError } = await admin.from("business_memberships")
    .select("role_key, status")
    .eq("business_id", caller.active_business_id).eq("user_id", userData.user.id).eq("status", "active").maybeSingle();
  if (membershipError || !membership || membership.status !== "active" || !["business_owner", "admin"].includes(membership.role_key)) return reply(403, { error: "Business administrator access required." });

  let input: unknown;
  try { input = await request.json(); } catch { return reply(400, { error: "Invalid request." }); }
  if (!input || typeof input !== "object") return reply(400, { error: "Invalid request." });
  const fields = input as Record<string, unknown>;
  const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
  const fullName = typeof fields.fullName === "string" ? fields.fullName.trim() : "";
  const password = typeof fields.password === "string" ? fields.password : "";
  const role = typeof fields.role === "string" ? fields.role : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || fullName.length > 120 || !role || role === "business_owner" || (role === "admin" && membership?.role_key !== "business_owner") || password.length < 12 || password.length > 128) {
    return reply(400, { error: "Enter a valid email, name, role, and a password of 12 to 128 characters." });
  }
  const { data: roleData, error: roleError } = await admin.from("business_roles")
    .select("role_key, permissions").eq("business_id", caller.active_business_id).eq("role_key", role).maybeSingle();
  if (roleError || !roleData || (!roleData.permissions.includes("ledger_view") && !roleData.permissions.includes("staff_balances_view"))) return reply(400, { error: "Choose an existing role with business access." });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) return reply(400, { error: createError?.message ?? "Could not create user." });

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    full_name: fullName,
    active_business_id: caller.active_business_id,
  }, { onConflict: "id" });
  const { error: newMembershipError } = profileError ? { error: profileError } : await admin.from("business_memberships").insert({
    business_id: caller.active_business_id,
    user_id: created.user.id,
    role_key: role,
    status: "active",
  });
  if (profileError || newMembershipError) {
    await admin.auth.admin.deleteUser(created.user.id);
    console.error("Could not assign new business membership", profileError ?? newMembershipError);
    return reply(500, { error: "Could not assign the user's role; the new account was removed. Please try again." });
  }
  return reply(200, { id: created.user.id });
});
