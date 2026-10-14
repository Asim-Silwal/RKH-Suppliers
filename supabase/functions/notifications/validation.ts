export function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (u.hostname === "web.push.apple.com" || u.hostname.endsWith(".push.apple.com") ||
       u.hostname === "fcm.googleapis.com" || u.hostname === "updates.push.services.mozilla.com" ||
       u.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validSubscription(s: any) {
  return validEndpoint(s?.endpoint) && /^[A-Za-z0-9_-]{87}$/.test(s?.keys?.p256dh ?? "") && /^[A-Za-z0-9_-]{22}$/.test(s?.keys?.auth ?? "");
}
