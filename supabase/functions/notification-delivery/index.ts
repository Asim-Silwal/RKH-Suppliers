import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";
import { validEndpoint } from "../notifications/validation.ts";

// Cron uses a random server-only token held in Vault. This is not a user endpoint.
Deno.serve(async req => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = req.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2,"0")).join("");
    const { data: config, error: configError } = await admin.from("notification_dispatch_config").select("token_hash").eq("singleton",true).single();
    if (configError || config.token_hash !== hash) return new Response("Unauthorized", { status: 401 });
    const { data: keys, error: keyError } = await admin.from("notification_vapid").select("public_key,private_key").eq("singleton",true).maybeSingle();
    if (keyError) throw keyError;
    const { data: events, error } = await admin.rpc("claim_notification_events");
    if (error) throw error;
    for (const event of events ?? []) {
      const { data: targets, error: targetError } = await admin.rpc("notification_push_targets", { target_event: event.id });
      if (targetError) throw targetError;
      let accepted = 0, failed = 0;
      // Large teams require a separate per-device queue; do not silently truncate.
      if ((targets?.length ?? 0) > 200) {
        const { error } = await admin.from("notification_events").update({push_status:"failed",failed:targets.length,lease_until:null}).eq("id",event.id);
        if (error) throw error;
        continue;
      }
      for (let i=0; i<(targets?.length ?? 0); i+=20) {
        await Promise.all(targets.slice(i,i+20).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
          if (!keys || !validEndpoint(s.endpoint)) { failed++; return; }
          try {
            await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({id:event.id,title:event.title,body:event.body}),{
              vapidDetails:{subject:"https://rkh-suppliers-mockup-sandbox.vercel.app",publicKey:keys.public_key,privateKey:keys.private_key},TTL:86400,timeout:3000,
            }); accepted++;
          } catch (cause) {
            failed++;
            if ([404,410].includes((cause as {statusCode?:number}).statusCode ?? 0)) await admin.from("push_subscriptions").delete().eq("endpoint",s.endpoint);
          }
        }));
      }
      const { error: savedError } = await admin.from("notification_events").update({push_status:"complete",accepted,failed,lease_until:null}).eq("id",event.id);
      if (savedError) throw savedError;
    }
    return Response.json({processed:events?.length ?? 0});
  } catch {
    console.error("Notification delivery failed; unfinished leases will be retried.");
    return new Response("Delivery failed", {status:500});
  }
});
