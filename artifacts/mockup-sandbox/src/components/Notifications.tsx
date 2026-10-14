import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Bell, Send, X } from "lucide-react";
import { applicationKey, bindPushUser, boundPushUser, clearPushUser, needsHomeScreen, notificationApi, pushRegistration, pushSupported } from "../lib/notifications";
import "./Notifications.css";

export function NotificationSettings({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const running = useRef(false);
  const homeScreen = needsHomeScreen();
  const supported = pushSupported();
  useEffect(() => {
    if (!supported || homeScreen) return;
    let cancelled = false;
    Promise.all([pushRegistration().then(() => navigator.serviceWorker.ready), notificationApi({ action: "config" })]).then(async ([registration, config]) => {
      const subscription = await registration.pushManager.getSubscription();
      if (cancelled) return;
      setEnabled(Boolean(subscription && boundPushUser() === userId && Notification.permission === "granted"));
      if (!config.publicKey) throw new Error("Notifications are not configured yet.");
      setPublicKey(config.publicKey); setReady(true);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId, supported, homeScreen]);
  const toggle = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      // Request directly from this tap, before any network or service-worker await (Safari).
      const permission = enabled ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are blocked. Allow them in your device’s notification settings, then try again.");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (enabled) {
        if (subscription) {
          await notificationApi({ action: "unsubscribe", endpoint: subscription.endpoint });
          if (!await subscription.unsubscribe()) throw new Error("Could not turn off this device. Please try again.");
        }
        clearPushUser(); setEnabled(false);
      } else {
        if (subscription && boundPushUser() !== userId) { await subscription.unsubscribe(); subscription = null; }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) });
        await notificationApi({ action: "subscribe", subscription: subscription.toJSON() });
        bindPushUser(userId); setEnabled(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update notifications."); }
    finally { running.current = false; setBusy(false); }
  };
  return createPortal(<div className="notification-backdrop"><section className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-heading">
    <button className="notification-close" aria-label="Close notifications" onClick={onClose}><X size={20} /></button>
    <span className="notification-symbol"><Bell size={24} /></span><h2 id="notification-heading">Notifications</h2>
    <p>Receive updates from RKH Suppliers on this device, even when the app is closed.</p>
    {homeScreen ? <p className="notification-note">On iPhone, open this app from your Home Screen to enable notifications. Requires iOS 16.4 or later.</p> : !supported ? <p className="notification-note">This browser does not support push notifications. Try an up-to-date browser or your iPhone Home Screen app.</p> : <>
      <div className="notification-status"><span className={enabled ? "notification-dot on" : "notification-dot"} />{enabled ? "Enabled on this device" : "Off on this device"}</div>
      <p className="notification-note">Messages may appear on your Lock Screen. You can adjust previews in your device settings.</p>
      <button className="admin-primary-button" disabled={!ready || busy} onClick={() => void toggle()}>{busy ? "Updating…" : enabled ? "Turn off notifications" : "Enable notifications"}</button>
    </>}
    {error && <p role="alert" className="notification-error">{error}</p>}
  </section></div>, document.body);
}

type Recipient = { user_id: string; email: string; full_name: string | null };
type SendRecord = { id: string; title: string; status: string; accepted: number; failed: number; expired: number; created_at: string };
export function NotificationSender({ users }: { users: Recipient[] }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("all"); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [result, setResult] = useState("");
  const [history, setHistory] = useState<SendRecord[]>([]);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const running = useRef(false);
  const refresh = async () => { const data = await notificationApi({ action: "history" }); setHistory(data.history); };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (running.current) return;
    running.current = true; setBusy(true); setError(""); setResult("");
    const fingerprint = JSON.stringify([title.trim(), body.trim(), recipient]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const data = await notificationApi({ action: "send", id: request.current.id, title, body, recipient });
      setResult(data.status === "sending" ? "This send is still processing. Refresh recent sends shortly." : `${data.accepted} device(s) accepted by the push service. ${data.failed} failed; ${data.expired} expired.`);
      if (data.status === "complete") { setTitle(""); setBody(""); request.current = null; }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send notification."); }
    finally { running.current = false; setBusy(false); }
  };
  return <div className="notification-sender">
    <div className="admin-section-intro"><div><h2>Notification sender</h2><p>Send an update to devices where users have enabled notifications.</p></div></div>
    <div className="notification-compose-grid"><form onSubmit={send} className="notification-form">
      <label>Send to<select value={recipient} disabled={busy} onChange={e => setRecipient(e.target.value)}><option value="all">Everyone with notifications enabled</option>{users.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}</select></label>
      <label>Title <input required maxLength={80} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="e.g. Team reminder" /></label>
      <label>Message <textarea required maxLength={500} rows={4} value={body} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="Write your update…" /><small>{body.length}/500</small></label>
      <p className="notification-note">This sends immediately. Messages may be visible on recipients’ Lock Screens.</p>
      <button className="admin-primary-button" disabled={busy || !title.trim() || !body.trim()}><Send size={16} />{busy ? "Sending…" : "Send notification"}</button>
      {error && <p role="alert" className="notification-error">{error}</p>}{result && <p role="status">{result}</p>}
    </form><aside className="notification-preview"><small>NOTIFICATION PREVIEW</small><div><img src={`${import.meta.env.BASE_URL}brand/icon-192.png`} alt="" /><span><small>RKH SUPPLIERS · now</small><strong>{title || "Your notification title"}</strong><p>{body || "Your message will appear here."}</p></span></div><p>Delivery depends on device permission, connectivity, and Focus settings.</p></aside></div>
    <div className="notification-history"><div><h3>Recent sends</h3><button type="button" onClick={() => void refresh().catch(e => setError(e.message))}>Refresh</button></div>{!history.length ? <p>No notifications sent yet.</p> : history.map(item => <article key={item.id}><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString()}</small><p>{item.status === "sending" ? "Processing / outcome not yet confirmed" : `${item.accepted} accepted · ${item.failed} failed · ${item.expired} expired`}</p></article>)}</div>
  </div>;
}
