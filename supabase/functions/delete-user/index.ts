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
  const { data: caller } = await admin.from("profiles").select("active_business_id").eq("id", callerData.user.id).maybeSingle();
  if (!caller?.active_business_id) return reply(403, { error: "Select a business workspace first." });
  const { data: membership } = await admin.from("business_memberships").select("role_key, status")
    .eq("business_id", caller.active_business_id).eq("user_id", callerData.user.id).eq("status", "active").maybeSingle();
  if (!membership || membership.status !== "active" || !["business_owner", "admin"].includes(membership.role_key)) return reply(403, { error: "Business administrator access required." });

  let input: unknown;
  try { input = await request.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const userId = input && typeof input === "object" && "userId" in input && typeof input.userId === "string" ? input.userId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return reply(400, { error: "Choose a valid user." });
  if (userId === callerData.user.id) return reply(400, { error: "You cannot remove your own business access." });
  const { data: targetMembership } = await admin.from("business_memberships").select("user_id, role_key")
    .eq("business_id", caller.active_business_id).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!targetMembership) return reply(404, { error: "Business member not found." });
  if (targetMembership.role_key === "business_owner") return reply(409, { error: "Transfer business ownership before removing the owner." });

  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id, full_name, active_business_id").eq("id", userId).maybeSingle();
  if (profileError || !profile) return reply(404, { error: "User not found." });
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
  if (targetError || !target.user) return reply(404, { error: "Auth user not found." });
  const displayName = profile.full_name?.trim() || target.user.email || "Former user";
  const { error: snapshotError } = await admin.from("cooperative_entries")
    .update({ recorded_by_name: displayName }).eq("business_id", caller.active_business_id).eq("recorded_by", userId);
  if (snapshotError) return reply(500, { error: "Could not preserve the user's Sahakari history." });

  const { error: removeMembershipError } = await admin.from("business_memberships")
    .delete().eq("business_id", caller.active_business_id).eq("user_id", userId);
  if (removeMembershipError) return reply(500, { error: "Could not remove business access." });
  const { data: remaining, error: remainingError } = await admin.from("business_memberships")
    .select("business_id, status").eq("user_id", userId).neq("business_id", caller.active_business_id).neq("status", "removed");
  if (remainingError) return reply(500, { error: "Could not verify remaining business access." });
  if ((remaining?.length ?? 0) > 0) {
    if (profile.active_business_id === caller.active_business_id) {
      const nextActiveBusiness = remaining!.find((item) => item.status === "active")?.business_id ?? null;
      const { error: switchError } = await admin.from("profiles").update({ active_business_id: nextActiveBusiness }).eq("id", userId);
      if (switchError) return reply(500, { error: "Membership was removed, but the user's active workspace could not be updated." });
    }
    return reply(200, { removed: true, accountRetained: true });
  }
  if (profile.active_business_id === caller.active_business_id) {
    const { error: clearActiveError } = await admin.from("profiles").update({ active_business_id: null }).eq("id", userId);
    if (clearActiveError) return reply(500, { error: "Membership was removed, but the user's active workspace could not be cleared." });
  }
  return reply(200, { removed: true, accountRetained: true });
});
