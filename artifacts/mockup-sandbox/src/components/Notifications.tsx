import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Bell, CheckCheck, Landmark, ReceiptText, RefreshCw, Send, Settings, UsersRound, X } from "lucide-react";
import { applicationKey, bindPushUser, boundPushUser, clearPushUser, needsHomeScreen, notificationApi, pushRegistration, pushSupported } from "../lib/notifications";
import "./Notifications.css";
import { supabase } from "../lib/supabase";
import "./UserManagement.css";

type InboxItem = { event_id: string; category: "admin" | "activity"; title: string; body: string; created_at: string; read_at: string | null };
export function NotificationInbox({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [tab, setTab] = useState<"admin" | "activity">("admin");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [marking, setMarking] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (cursor?: InboxItem) => {
    const request = ++sequence.current;
    setLoading(true); setError("");
    try {
      let query = supabase.from("notification_inbox").select("event_id,category,title,body,created_at,read_at").eq("user_id",userId).eq("category",tab).order("created_at",{ascending:false}).order("event_id",{ascending:false}).limit(30);
      if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},event_id.lt.${cursor.event_id})`);
      const { data, error } = await query;
      if (error) throw error;
      if (sequence.current !== request) return;
      const rows = (data ?? []) as InboxItem[];
      setItems(previous => cursor ? [...previous,...rows.filter(row => !previous.some(item => item.event_id === row.event_id))] : rows);
      setMore(rows.length === 30);
    } catch { if (sequence.current === request) setError("Could not load notifications. Please try again."); }
    finally { if (sequence.current === request) setLoading(false); }
  },[userId,tab]);
  useEffect(() => {
    setItems([]); setMore(false); void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus",refresh);
    return () => { sequence.current++; window.removeEventListener("focus",refresh); };
  },[load]);
  const markRead = async (item?: InboxItem) => {
    if (marking) return;
    setMarking(true); setError("");
    const timestamp = new Date().toISOString();
    try {
      let query = supabase.from("notification_inbox").update({read_at:timestamp}).eq("user_id",userId).eq("category",tab).is("read_at",null);
      if (item) query = query.eq("event_id",item.event_id);
      const { error } = await query;
      if (error) throw error;
      setItems(previous => previous.map(row => row.category === tab && (!item || row.event_id === item.event_id) ? {...row,read_at:row.read_at ?? timestamp} : row));
    } catch { setError("Could not mark notifications as read. Please try again."); }
    finally { setMarking(false); }
  };
  return <div className="notification-inbox">
    <header className="inbox-header"><button type="button" aria-label="Go back" onClick={onBack}><ArrowLeft size={23} /></button><h1>Notifications</h1><button type="button" aria-label="Notification settings" onClick={() => setSettings(true)}><Settings size={21} /></button></header>
    <div className="inbox-tabs" role="tablist" aria-label="Notification categories"><button role="tab" aria-selected={tab === "admin"} onClick={() => setTab("admin")}><Bell size={17} />Admin</button><button role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}><ReceiptText size={17} />Activity</button></div>
    <div className="inbox-tools"><span>{tab === "admin" ? "Updates from your admin" : "Parties, transactions & Sahakari"}</span><button aria-label="Refresh notifications" disabled={loading} onClick={() => void load()}><RefreshCw size={16} /></button><button disabled={marking || !items.some(item => !item.read_at)} onClick={() => void markRead()}><CheckCheck size={16} /><span>Mark all read</span></button></div>
    {error && <div className="inbox-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}
    <div className="inbox-list" role="tabpanel" aria-label={tab === "admin" ? "Admin notifications" : "Activity notifications"} aria-busy={loading}>
      {!loading && !error && !items.length && <div className="inbox-empty"><Bell size={34} /><h2>You’re all caught up</h2><p>{tab === "admin" ? "Messages from your admin will appear here." : "New parties, transactions, and Sahakari deposits will appear here."}</p></div>}
      {items.map(item => {
        const Icon = item.category === "admin" ? Bell : item.title === "Party Added" ? UsersRound : item.title === "Sahakari Deposited" ? Landmark : ReceiptText;
        return <button type="button" className={`inbox-item${item.read_at ? "" : " unread"}`} key={item.event_id} onClick={() => { if (!item.read_at) void markRead(item); }} aria-label={`${item.read_at ? "" : "Unread: "}${item.title}. ${item.body}`}>
          <span className={`inbox-icon ${item.category}`}><Icon size={21} /></span><span className="inbox-copy"><strong>{item.title}</strong><span>{item.body}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-GB",{timeZone:"Asia/Kathmandu",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</time></span>{!item.read_at && <span className="inbox-unread-dot" />}
        </button>;
      })}
      {loading && <p className="inbox-loading" role="status">Loading notifications…</p>}
      {more && !loading && <button className="inbox-load-more" onClick={() => void load(items[items.length-1])}>Load older notifications</button>}
    </div>
    {settings && <NotificationSettings userId={userId} onClose={() => setSettings(false)} />}
  </div>;
}

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
    <span className="notification-symbol"><Bell size={24} /></span><h2 id="notification-heading">Device notifications</h2>
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
export function NotificationAdminPage() {
  const [users, setUsers] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("list_app_users");
        if (error) throw error;
        if (!cancelled) setUsers(data ?? []);
      } catch {
        if (!cancelled) setError("Could not load recipients. Check your connection and try again.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [attempt]);
  return <div className="admin-console">
    <header className="admin-console-header"><div><span className="eyebrow">OWNER ACCESS / TEAM UPDATES</span><h1>Send notifications</h1><p>Compose updates and review recent sends in one place.</p></div><span className="admin-owner-badge"><Bell size={15} /> Owner only</span></header>
    <section className="admin-workspace">
      {loading ? <div className="admin-empty">Loading recipients…</div> : error ? <div className="admin-empty"><p role="alert">{error}</p><button className="admin-primary-button" onClick={() => setAttempt(a => a + 1)}>Try again</button></div> : <NotificationSender users={users} />}
    </section>
  </div>;
}
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
      setResult(data.status === "sending" ? "This send is still processing. Refresh recent sends shortly." : `Saved to recipients’ inboxes. ${data.accepted} device(s) accepted by the push service. ${data.failed} failed; ${data.expired} expired.`);
      if (data.status === "complete") { setTitle(""); setBody(""); request.current = null; }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send notification."); }
    finally { running.current = false; setBusy(false); }
  };
  return <div className="notification-sender">
    <div className="admin-section-intro"><div><h2>Notification sender</h2><p>Send an inbox update to your team, with push alerts on enabled devices.</p></div></div>
    <div className="notification-compose-grid"><form onSubmit={send} className="notification-form">
      <label>Send to<select value={recipient} disabled={busy} onChange={e => setRecipient(e.target.value)}><option value="all">Everyone</option>{users.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}</select></label>
      <label>Title <input required maxLength={80} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="e.g. Team reminder" /></label>
      <label>Message <textarea required maxLength={500} rows={4} value={body} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="Write your update…" /><small>{body.length}/500</small></label>
      <p className="notification-note">This sends immediately. Messages may be visible on recipients’ Lock Screens.</p>
      <button className="admin-primary-button" disabled={busy || !title.trim() || !body.trim()}><Send size={16} />{busy ? "Sending…" : "Send notification"}</button>
      {error && <p role="alert" className="notification-error">{error}</p>}{result && <p role="status">{result}</p>}
    </form><aside className="notification-preview"><small>NOTIFICATION PREVIEW</small><div><img src={`${import.meta.env.BASE_URL}brand/icon-192.png`} alt="" /><span><small>RKH SUPPLIERS · now</small><strong>{title || "Your notification title"}</strong><p>{body || "Your message will appear here."}</p></span></div><p>Delivery depends on device permission, connectivity, and Focus settings.</p></aside></div>
    <div className="notification-history"><div><h3>Recent sends</h3><button type="button" onClick={() => void refresh().catch(e => setError(e.message))}>Refresh</button></div>{!history.length ? <p>No notifications sent yet.</p> : history.map(item => <article key={item.id}><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString()}</small><p>{item.status === "sending" ? "Processing / outcome not yet confirmed" : `${item.accepted} accepted · ${item.failed} failed · ${item.expired} expired`}</p></article>)}</div>
  </div>;
}
