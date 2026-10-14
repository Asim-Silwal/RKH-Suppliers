import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";
import { validEndpoint, validId, validSubscription } from "./validation.ts";

const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply({ error: "Sign in first." }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return reply({ error: "Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 12000) return reply({ error: "Request too large." }, 413);
    let input;
    try { input = JSON.parse(raw); } catch { return reply({ error: "Invalid request." }, 400); }
    // Generate once on the server; the private key never enters client responses or source control.
    let { data: credentials, error: keyError } = await admin.from("notification_vapid").select("public_key,private_key").eq("singleton", true).maybeSingle();
    if (keyError) throw keyError;
    if (!credentials) {
      const keys = webpush.generateVAPIDKeys();
      const { error } = await admin.from("notification_vapid").insert({ singleton: true, public_key: keys.publicKey, private_key: keys.privateKey });
      if (error && error.code !== "23505") throw error;
      const result = await admin.from("notification_vapid").select("public_key,private_key").eq("singleton", true).single();
      if (result.error) throw result.error;
      credentials = result.data;
    }
    const publicKey = credentials.public_key;
    const privateKey = credentials.private_key;
    if (input.action === "config") return reply({ publicKey: publicKey ?? null });
    if (input.action === "subscribe") {
      if (!publicKey || !privateKey) return reply({ error: "Notifications are not configured yet." }, 503);
      if (!validSubscription(input.subscription)) return reply({ error: "Invalid push subscription." }, 400);
      const s = input.subscription;
      const { error } = await admin.from("push_subscriptions").upsert({ endpoint: s.endpoint, user_id: user.id, p256dh: s.keys.p256dh, auth: s.keys.auth, updated_at: new Date().toISOString() });
      if (error) throw error;
      return reply({ ok: true });
    }
    if (input.action === "unsubscribe") {
      if (!validEndpoint(input.endpoint)) return reply({ error: "Invalid subscription." }, 400);
      const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", input.endpoint).eq("user_id", user.id);
      if (error) throw error;
      return reply({ ok: true });
    }
    const { data: owner, error: ownerError } = await admin.from("app_owner").select("user_id").eq("user_id", user.id).maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return reply({ error: "Only the owner can send notifications." }, 403);
    if (input.action === "history") {
      const { data, error } = await admin.from("notification_sends").select("id,title,body,status,accepted,failed,expired,created_at").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return reply({ history: data });
    }
    if (input.action !== "send") return reply({ error: "Unknown action." }, 400);
    if (!publicKey || !privateKey) return reply({ error: "Notifications are not configured yet." }, 503);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!title || title.length > 80 || !body || body.length > 500 || !validId(input.id) || (input.recipient !== "all" && !validId(input.recipient))) return reply({ error: "Enter a title, message, and valid recipient." }, 400);
    const { data: previous, error: previousError } = await admin.from("notification_sends").select("*").eq("id", input.id).maybeSingle();
    if (previousError) throw previousError;
    if (previous) return reply(previous);
    const { count, error: limitError } = await admin.from("notification_sends").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 60000).toISOString());
    if (limitError) throw limitError;
    if ((count ?? 0) >= 5) return reply({ error: "Please wait a minute before sending more notifications." }, 429);
    let query = admin.from("push_subscriptions").select("endpoint,p256dh,auth");
    if (input.recipient !== "all") query = query.eq("user_id", input.recipient);
    const { data: subscriptions, error: subError } = await query.limit(201);
    if (subError) throw subError;
    if (subscriptions && subscriptions.length > 200) return reply({ error: "Too many devices for one send. Select an individual user." }, 400);
    if (!subscriptions?.length) return reply({ error: "No enabled devices for these recipients. Ask them to enable notifications in their profile." }, 400);
    const { error: insertError } = await admin.from("notification_sends").insert({ id: input.id, sender_id: user.id, recipient_id: input.recipient === "all" ? null : input.recipient, title, body });
    if (insertError?.code === "23505") return reply({ error: "This notification is already being sent. Check recent sends." }, 409);
    if (insertError) throw insertError;
    let accepted = 0, failed = 0, expired = 0;
    // Bound concurrency and timeouts to keep a small team send within the function budget.
    for (let i = 0; i < subscriptions.length; i += 20) {
      await Promise.all(subscriptions.slice(i, i + 20).map(async (s) => {
        if (!validEndpoint(s.endpoint)) { failed++; return; }
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, id: input.id }), { vapidDetails: { subject: "https://rkh-suppliers-mockup-sandbox.vercel.app", publicKey, privateKey }, TTL: 86400, timeout: 8000 });
          accepted++;
        } catch (error) {
          if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) {
            expired++;
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else failed++;
        }
      }));
    }
    const result = { status: "complete", accepted, failed, expired };
    const { error: updateError } = await admin.from("notification_sends").update(result).eq("id", input.id);
    if (updateError) throw updateError;
    return reply(result);
  } catch (error) {
    console.error("Notification operation failed", (error as { code?: string }).code ?? "internal");
    return reply({ error: "Could not complete this request. Check recent sends before retrying." }, 500);
  }
});
