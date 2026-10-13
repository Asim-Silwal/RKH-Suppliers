import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { enrollDevice, unlockDevice, type DeviceCredential } from "../lib/deviceLock";

const mobileDevice = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const storageKey = (id: string) => `rkh-device-lock-v1:${id}`;
function readCredential(id: string): DeviceCredential | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(id)) ?? "null");
    return value?.id && value?.publicKey ? value : null;
  } catch { return null; }
}
function cover(locked: boolean) {
  if (locked) document.documentElement.dataset.appLocked = "true";
  else delete document.documentElement.dataset.appLocked;
}

// A device privacy gate, independent of Supabase authentication/RLS.
// No private key, password, or unlocked flag is persisted by this component.
export function MobileLock({ children }: { children: ReactNode }) {
  const [mobile] = useState(mobileDevice);
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [ready, setReady] = useState(!mobile);
  const [unlocked, setUnlocked] = useState(false);
  const [mountedAccount, setMountedAccount] = useState<string | null>(null);
  const [credential, setCredential] = useState<DeviceCredential | null>(null);
  const [supported, setSupported] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountRef = useRef<string | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (!mobile) return;
    let live = true;
    cover(true);
    const update = (session: { user: { id: string; email?: string } } | null) => {
      if (!live) return;
      const id = session?.user.id ?? null;
      if (id !== accountRef.current) {
        generation.current++;
        accountRef.current = id;
        verifiedRef.current = false;
        setVerified(false); setPassword(""); setError(""); setPasswordMode(false);
        setUnlocked(false); setMountedAccount(null);
        setCredential(id ? readCredential(id) : null);
        setAccount(session ? { id: session.user.id, email: session.user.email ?? "" } : null);
      }
      cover(Boolean(session));
      setReady(true);
    };
    let eventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      eventReceived = true;
      // Token refresh must not relock an already open workspace.
      if (event === "TOKEN_REFRESHED" && session?.user.id === accountRef.current) return;
      if (session?.user.id === accountRef.current && session) return;
      update(session);
    });
    void supabase.auth.getSession().then(({ data }) => { if (!eventReceived) update(data.session); }).catch(() => { if (!eventReceived) update(null); });
    if (window.PublicKeyCredential && window.isSecureContext) {
      void PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((available) => { if (live) setSupported(available); }).catch(() => {});
    }
    const lock = () => {
      if (!accountRef.current) return;
      cover(true); setUnlocked(false); setPassword("");
      // Native authentication sheets can briefly hide the document.
      if (!busyRef.current) { generation.current++; verifiedRef.current = false; setVerified(false); }
    };
    const visibility = () => { if (document.visibilityState === "hidden") lock(); };
    window.addEventListener("pagehide", lock);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("rkh-lock", lock);
    return () => { live = false; subscription.unsubscribe(); window.removeEventListener("pagehide", lock); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("rkh-lock", lock); cover(false); };
  }, [mobile]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Verification was cancelled. Try again or use your account password." : cause instanceof Error ? cause.message : "Could not verify. Please try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const reveal = (id: string, version: number) => {
    if (accountRef.current !== id || generation.current !== version || document.visibilityState !== "visible") return;
    setMountedAccount(id); setUnlocked(true); setPassword(""); setPasswordMode(false);
    verifiedRef.current = false; setVerified(false); cover(false);
  };
  const verifyPassword = () => run(async () => {
    if (!account || !password) return;
    const version = generation.current;
    const { data, error: failure } = await supabase.auth.signInWithPassword({ email: account.email, password });
    setPassword("");
    if (failure || data.user?.id !== account.id) throw new Error("Password verification failed. Check your account password and try again.");
    if (generation.current !== version || accountRef.current !== account.id || document.visibilityState !== "visible") return;
    verifiedRef.current = true; setVerified(true);
    if (!supported || credential) reveal(account.id, version);
  });
  const enroll = () => run(async () => {
    if (!account || !verifiedRef.current) return;
    const version = generation.current;
    const next = await enrollDevice(account.id, account.email);
    if (accountRef.current !== account.id || generation.current !== version) return;
    localStorage.setItem(storageKey(account.id), JSON.stringify(next));
    setCredential(next); reveal(account.id, version);
  });
  const unlock = () => run(async () => {
    if (!account || !credential) return;
    const version = generation.current;
    await unlockDevice(credential);
    reveal(account.id, version);
  });

  if (!mobile) return <>{children}</>;
  if (ready && !account) return <>{children}</>;
  const locked = !ready || !unlocked;
  return <>
    {account && mountedAccount === account.id && children}
    {locked && createPortal(<main id="mobile-lock-root" className="mobile-lock-screen">
      <section className="mobile-lock-card">
        <img className="mobile-lock-logo" src={`${import.meta.env.BASE_URL}brand/logo.png`} alt="RKH Suppliers Kathmandu" />
        <span className="mobile-lock-brand">RKH LEDGER</span>
        <h1>{!ready ? "Opening securely" : credential ? "Your ledger is locked" : "Protect this device"}</h1>
        <p>{!ready ? "Checking your session…" : credential ? "Verify with Face ID, Touch ID, or your device passcode to continue." : "Confirm your account password, then set up a passkey to lock your ledger whenever you leave the app."}</p>
        {ready && account && <>
          {credential && !passwordMode && <button className="mobile-lock-primary" disabled={busy} onClick={unlock}>{busy ? "Verifying…" : "Unlock with Face ID / passcode"}</button>}
          {(!credential || passwordMode) && !verified && <form onSubmit={(event) => { event.preventDefault(); void verifyPassword(); }}>
            <label>Account password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
            <button className="mobile-lock-primary" disabled={busy}>{busy ? "Verifying…" : "Verify password"}</button>
          </form>}
          {verified && supported && !credential && <button className="mobile-lock-primary" disabled={busy} onClick={enroll}>{busy ? "Setting up…" : "Enable Face ID / passcode"}</button>}
          {verified && !credential && <button className="mobile-lock-secondary" disabled={busy} onClick={() => { if (account && verifiedRef.current) reveal(account.id, generation.current); }}>Continue with account password</button>}
          {!supported && !credential && <small>This browser has no device verification available. Your account password will unlock the app each time.</small>}
          {credential && <button className="mobile-lock-secondary" disabled={busy} onClick={() => { setPasswordMode(!passwordMode); setError(""); }}>{passwordMode ? "Use Face ID / passcode" : "Use account password instead"}</button>}
          <button className="mobile-lock-secondary" disabled={busy} onClick={() => run(async () => { const { error: failure } = await supabase.auth.signOut(); if (failure) throw failure; })}>Sign out</button>
        </>}
        {error && <p className="mobile-lock-error" role="alert">{error}</p>}
      </section>
    </main>, document.body)}
  </>;
}
