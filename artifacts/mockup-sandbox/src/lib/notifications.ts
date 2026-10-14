import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export async function notificationApi(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("notifications", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = await error.context.json().catch(() => null);
      throw new Error(response?.error || "Could not complete the notification request.");
    }
    throw new Error("Could not reach notifications. Check your connection and try again.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const needsHomeScreen = () => (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) && !window.matchMedia("(display-mode: standalone)").matches && !(navigator as Navigator & { standalone?: boolean }).standalone;
export const pushRegistration = () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
export function applicationKey(key: string) {
  const binary = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
const bindingKey = "rkh-push-user";
export function bindPushUser(userId: string) { localStorage.setItem(bindingKey, userId); }
export function boundPushUser() { return localStorage.getItem(bindingKey); }
export function clearPushUser() { localStorage.removeItem(bindingKey); }

// Runs outside the privacy lock so a sign-out or account switch also disconnects push.
export function watchPushAccount() {
  if (!pushSupported()) return;
  let queue = Promise.resolve();
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id;
    queue = queue.then(async () => {
      const bound = boundPushUser();
      if (!bound || bound === userId) return;
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && !await subscription.unsubscribe()) throw new Error("Could not disconnect push");
      clearPushUser();
    }).catch(() => { /* Retry on the next auth event; never mark a failed cleanup complete. */ });
  });
}
