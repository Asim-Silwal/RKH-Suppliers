import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  CalendarDays,
  Check,
  Download,
  FileText,
  ImagePlus,
  LayoutDashboard,
  Landmark,
  LogOut,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";

import { supabase } from "./lib/supabase";
import { NepaliDatePicker, todayDates } from "./components/NepaliDatePicker";
import { EnglishDatePicker } from "./components/EnglishDatePicker";
import { SahakariPage, SahakariProvider } from "./components/Sahakari";
import { UserManagement, type UserRole, type Permission } from "./components/UserManagement";
import { StaffOverview } from "./components/StaffOverview";
import NepaliDate from "nepali-date-converter";
import ledgerMark from "./assets/rkh-ledger-mark.svg";
import statementFontUrl from "./assets/NotoSansDevanagariUI-Regular.ttf?url";

type EntryType = "PURCHASE" | "PAYMENT";
type UserProfile = {
  userId: string;
  role: UserRole;
  roleName: string;
  permissions: Permission[];
  isOwner: boolean;
  email: string;
  fullName: string;
  contact: string;
  avatarPath: string | null;
};
type DashboardPeriod = "week" | "month" | "year" | "custom" | "lifetime";

type Party = {
  id: string;
  partyType: "customer" | "supplier";
  name: string;
  company?: string;
  contact?: string;
  location?: string;
  notes?: string;
};

type Entry = {
  id: string;
  partyId: string;
  type: EntryType;
  amount: number;
  ad: string;
  bs: string;
  description: string;
};

type Notice = {
  id: number;
  title: string;
  detail: string;
  tone: "success" | "error";
};

const toCents = (value: number) => Math.round(value * 100);

function parseMoneyCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const money = (value: number) =>
  `NPR ${(toCents(value) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function downloadPdf(filename: string, bytes: Uint8Array) {
  const safeBytes = Uint8Array.from(bytes);
  const file = new File([safeBytes.buffer], filename, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const partyName = (parties: Party[], id: string) =>
  parties.find((party) => party.id === id)?.name ?? "Unknown party";

const entryLabel = (entry: Entry, party?: Party) => {
  if (party?.partyType === "supplier") {
    return entry.type === "PURCHASE" ? "Purchase" : "Payment made";
  }
  return entry.type === "PURCHASE" ? "Sale" : "Payment received";
};

const entryDescription = (entry: Entry) =>
  entry.description === "Payment received with purchase"
    ? "Payment received with sale"
    : entry.description;

const partySlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

const partySegment = (party: Party, parties: Party[]) => {
  const slug = partySlug(party.name) || party.id;
  const duplicate = parties.some((item) => item.id !== party.id && partySlug(item.name) === slug);
  return duplicate ? `${slug}--${party.id}` : slug;
};

const partyPath = (party: Party, parties: Party[]) =>
  `parties/${encodeURIComponent(partySegment(party, parties))}`;

const findPartyByRoute = (parties: Party[], segment: string) =>
  parties.find((party) => party.id === segment) ??
  parties.find((party) => partySegment(party, parties) === segment);

const matchingParties = (parties: Party[], query: string) =>
  parties.filter((party) => `${party.name} ${party.company ?? ""} ${party.contact ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

const partyPhoneIsValid = (contact: string) => !contact.trim() || /^\d{10}$/.test(contact.trim());

const partySaveErrorMessage = (message: string) =>
  /party_type/i.test(message)
    ? "Supplier setup needs the party type database update. Apply the included Supabase migration, then try again."
    : message || "Please try again.";

const balancesByParty = (entries: Entry[]) => {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    balances.set(entry.partyId, (balances.get(entry.partyId) ?? 0) + (entry.type === "PURCHASE" ? toCents(entry.amount) : -toCents(entry.amount)));
  }
  return balances;
};

const LIST_PAGE_SIZE = 50;

const bsDate = (date: Date) => new NepaliDate(date).format("YYYY-MM-DD");

function currentBsRange(period: "week" | "month" | "year") {
  const today = new NepaliDate();
  const year = today.getYear();
  const month = today.getMonth();
  let first: Date;
  let last: Date;

  if (period === "week") {
    first = today.toJsDate();
    first.setDate(first.getDate() - today.getDay());
    last = new Date(first);
    last.setDate(last.getDate() + 6);
  } else {
    first = new NepaliDate(year, period === "month" ? month : 0, 1).toJsDate();
    const next = period === "year"
      ? new NepaliDate(year + 1, 0, 1)
      : month === 11
        ? new NepaliDate(year + 1, 0, 1)
        : new NepaliDate(year, month + 1, 1);
    last = next.toJsDate();
    last.setDate(last.getDate() - 1);
  }

  return { from: bsDate(first), to: bsDate(last) };
}

function currentRoute() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const pathname = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname;

  const parts = pathname.split("/").filter(Boolean);

  return {
    path: parts[0] || "dashboard",
    id: parts[1] ? decodeURIComponent(parts[1]) : undefined,
  };
}

function go(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  window.history.pushState({}, "", `${base}/${path}`);

  window.dispatchEvent(new PopStateEvent("popstate"));
}

/* =========================================================
   APP SHELL
   ========================================================= */

function Shell({
  active,
  children,
  contentKey,
  onLogout,
  role,
  profile,
  avatarUrl,
  onSaveProfile,
  snapshot,
}: {
  active: string;
  children: ReactNode;
  contentKey: string;
  onLogout: () => void;
  role: UserRole;
  profile: UserProfile;
  avatarUrl: string | null;
  onSaveProfile: (fullName: string, contact: string, photo: File | null) => Promise<string | null>;
  snapshot: { outstanding: number; payable: number; partyCount: number; todayBs: string };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [contentKey]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const can = (permission: Permission) => profile.permissions.includes(permission);
  const links = can("staff_balances_view") ? [
    ["dashboard", "Balances", LayoutDashboard],
  ] as const : [
    ["dashboard", "Dashboard", LayoutDashboard],
    ...(can("ledger_view") ? [["parties", "Parties", UsersRound] as const, ["transactions", "Statement", FileText] as const] : []),
    ...(can("transactions_write") ? [["add-entry", "Add transaction", Plus] as const] : []),
    ...(can("reports_view") ? [["reports", "Reports", BarChart3] as const] : []),
    ...(can("sahakari_view") ? [["sahakari", "Sahakari", Landmark] as const] : []),
    ...(profile.isOwner ? [["users", "Users", UsersRound] as const] : []),
  ] as const;

  return (
    <div className="reference-app">
      <aside className="reference-sidebar">
        <button
          className="reference-brand"
          onClick={() => go("dashboard")}
        >
          <img className="brand-mark" src={ledgerMark} alt="" />

          <strong>RKH Ledger</strong>

          <small>
            RKH SUPPLIERS ·
            <br />
            KATHMANDU
          </small>
        </button>

        <nav aria-label="Main navigation">
          <label>LEDGER</label>

          {links.map(([href, label, Icon]) => (
            <button
              key={href}
              className={active === href ? "nav-active" : ""}
              onClick={() => go(href)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        {can("ledger_view") && <footer className="sidebar-snapshot">
          <span className="sidebar-snapshot-heading">LEDGER AT A GLANCE</span>
          <div className="sidebar-balance-summary">
            <div><span>To collect</span><strong>{money(snapshot.outstanding)}</strong><small>Lifetime customer payments due</small></div>
            <div><span>To pay</span><strong>{money(snapshot.payable)}</strong><small>Lifetime supplier payments due</small></div>
          </div>
          <div className="sidebar-snapshot-meta">
            <span>{snapshot.partyCount} {snapshot.partyCount === 1 ? "party" : "parties"}</span>
            <span>{snapshot.todayBs} BS</span>
          </div>
        </footer>}
      </aside>

      <main className={`reference-main${active === "dashboard" ? " dashboard-main" : ""}`}>
        <div className="profile-toolbar" ref={menuRef}>
          <button type="button" className="mobile-brand" onClick={() => go("dashboard")} aria-label="RKH Ledger dashboard">
            <img src={ledgerMark} alt="" /><span>RKH Ledger</span>
          </button>
          <button type="button" className="profile-trigger" aria-label="Open profile" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <ProfileAvatar profile={profile} avatarUrl={avatarUrl} />
          </button>
          {menuOpen && <div className="profile-menu">
            <div className="profile-menu-person"><ProfileAvatar profile={profile} avatarUrl={avatarUrl} /><div><strong>{profile.fullName || "Your profile"}</strong><small>{profile.email}</small></div></div>
            <dl><div><dt>Contact</dt><dd>{profile.contact || "Not provided"}</dd></div><div><dt>Role</dt><dd>{profile.roleName}</dd></div></dl>
            <button type="button" onClick={() => { setMenuOpen(false); setEditing(true); }}>Edit profile</button>
            <button type="button" onClick={() => { setMenuOpen(false); onLogout(); }}><LogOut size={15} /> Sign out</button>
          </div>}
        </div>
        <div className="page-transition" key={contentKey}>{children}</div>
      </main>
      {editing && <EditProfile profile={profile} avatarUrl={avatarUrl} onClose={() => setEditing(false)} onSave={onSaveProfile} />}
    </div>
  );
}

function ProfileAvatar({ profile, avatarUrl }: { profile: UserProfile; avatarUrl: string | null }) {
  const initials = profile.fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || profile.email[0]?.toUpperCase() || "?";
  return <span className="profile-avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials}</span>;
}

function EditProfile({ profile, avatarUrl, onClose, onSave }: {
  profile: UserProfile;
  avatarUrl: string | null;
  onClose: () => void;
  onSave: (fullName: string, contact: string, photo: File | null) => Promise<string | null>;
}) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [contact, setContact] = useState(profile.contact);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoImage, setPhotoImage] = useState<HTMLImageElement | null>(null);
  const [verticalPosition, setVerticalPosition] = useState(50);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!photo) { setPhotoImage(null); return; }
    let cancelled = false;
    const url = URL.createObjectURL(photo);
    const image = new Image();
    image.onload = () => { if (!cancelled) setPhotoImage(image); };
    image.onerror = () => { if (!cancelled) setError("This image could not be opened. Choose another photo."); };
    image.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [photo]);
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !photoImage) return;
    const side = Math.min(photoImage.naturalWidth, photoImage.naturalHeight) / 1.12;
    const x = (photoImage.naturalWidth - side) / 2;
    const y = (photoImage.naturalHeight - side) * verticalPosition / 100;
    canvas.width = 512;
    canvas.height = 512;
    canvas.getContext("2d")?.drawImage(photoImage, x, y, side, side, 0, 0, 512, 512);
  }, [photoImage, verticalPosition]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, saving]);
  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The photo must be 5 MB or smaller.");
      return;
    }
    setError("");
    setPhotoImage(null);
    setPhoto(file);
    setVerticalPosition(50);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let adjustedPhoto: File | null = null;
      if (photo) {
        const canvas = previewCanvasRef.current;
        if (!photoImage || !canvas) throw new Error("Wait for the photo preview to load.");
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not prepare the photo.")), photo.type, 0.9),
        );
        adjustedPhoto = new File([blob], photo.name, { type: blob.type });
      }
      const saveError = await onSave(fullName.trim(), contact.trim(), adjustedPhoto);
      if (saveError) setError(saveError);
      else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the photo.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="profile-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
      <div className="profile-modal-head"><div><span className="eyebrow">ACCOUNT</span><h2 id="edit-profile-title">Edit profile</h2></div><button type="button" aria-label="Close profile editor" onClick={onClose} disabled={saving}><X size={18} /></button></div>
      <form onSubmit={submit}>
        <div className="profile-photo-editor">
          <div className="profile-photo-preview">
            {photo ? <canvas ref={previewCanvasRef} aria-label="Adjusted profile photo preview" role="img" /> : avatarUrl ? <img src={avatarUrl} alt="Current profile photo" /> : <span>{fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || profile.email[0]?.toUpperCase() || "?"}</span>}
          </div>
          <div className="profile-photo-controls">
            <strong>Profile photo</strong>
            <button type="button" className="profile-photo-pick" onClick={() => fileInputRef.current?.click()} disabled={saving}><ImagePlus size={16} />{photo || avatarUrl ? "Change photo" : "Choose photo"}</button>
            <input ref={fileInputRef} className="profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} disabled={saving} />
            <small>JPG, PNG, or WEBP · Up to 5 MB</small>
          </div>
        </div>
        {photo && <div className="profile-position-control">
          <label htmlFor="avatar-vertical">Adjust photo up or down</label>
          <input id="avatar-vertical" type="range" min="0" max="100" value={verticalPosition} onChange={(event) => setVerticalPosition(Number(event.target.value))} disabled={saving || !photoImage} />
          <div><span>Up</span><span>Down</span></div>
        </div>}
        <div className="modal-section-label"><strong>Account details</strong><small>Your email is used for sign-in and cannot be changed here.</small></div>
        <div className="profile-account-grid"><label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} disabled={saving} /></label>
        <label>Contact number<input value={contact} onChange={(event) => setContact(event.target.value)} type="tel" maxLength={40} disabled={saving} /></label>
        <label>Email<input value={profile.email} readOnly aria-readonly="true" /></label></div>
        <p className="profile-role-note">Role: {profile.roleName}</p>
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        <div className="profile-modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="black-button" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
      </form>
    </section>
  </div>;
}

/* =========================================================
   HEADER
   ========================================================= */

function Header({
  eyebrow,
  title,
  description,
  action,
  label,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <header className="reference-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>

        <h1>{title}</h1>

        <p>{description}</p>

        {action && label?.startsWith("Back to") && (
          <button className="back-link" onClick={action}>
            {label}
          </button>
        )}
      </div>

      {action && !label?.startsWith("Back to") && (
        <button className="black-button" onClick={action}>
          {label?.startsWith("View") ? <ArrowRight size={15} /> : <Plus size={15} />}
          {label}
        </button>
      )}
    </header>
  );
}

/* =========================================================
   TRANSACTION TABLE
   ========================================================= */

function Table({
  entries,
  parties,
  emptyMessage = "No transactions recorded yet.",
  selectedIds,
  onSelect,
  onEdit,
  selectionDisabled = false,
}: {
  entries: Entry[];
  parties: Party[];
  emptyMessage?: string;
  selectedIds?: Set<string>;
  onSelect?: (entry: Entry) => void;
  onEdit?: (entry: Entry) => void;
  selectionDisabled?: boolean;
}) {
  const partyById = new Map(parties.map((party) => [party.id, party]));
  return (
    <div className={`ledger-table${onSelect ? " selectable-table" : ""}`}>
      <div className={`ledger-row ledger-head${onSelect ? " selectable-ledger-row" : ""}`}>
        {onSelect && <span aria-label="Select transaction" />}
        <span>DATE (AD / BS)</span>
        <span>PARTY</span>
        <span>TYPE</span>
        <span>DESCRIPTION</span>
        <span>AMOUNT</span>
      </div>

      {entries.map((entry) => {
        const party = partyById.get(entry.partyId);
        const tone = party?.partyType === "supplier" ? (entry.type === "PAYMENT" ? "payment-out" : "purchase") : (entry.type === "PAYMENT" ? "payment-in" : "sale");
        return <div className={`ledger-row ${tone}${onSelect ? " selectable-ledger-row" : ""}${selectedIds?.has(entry.id) ? " is-selected" : ""}`} key={entry.id}>
          {onSelect && <input type="checkbox" className="transaction-select-checkbox" checked={selectedIds?.has(entry.id) ?? false} disabled={selectionDisabled} aria-label={`Select ${entry.type.toLowerCase()} of ${money(entry.amount)} on ${entry.bs} BS`} onChange={() => onSelect(entry)} />}
          <span>
            <b>{entry.ad}</b>
            <small>{entry.bs} BS</small>
          </span>

          <span>
            <b>{party?.name ?? "Unknown party"}</b>

            <small>
              {party?.company}
            </small>
          </span>

          <span className={`type ${tone}`}>
            {entryLabel(entry, party)}
          </span>

          <span>{entryDescription(entry) || "—"}</span>

          <strong><span>{money(entry.amount)}</span>{onEdit && <button type="button" className="transaction-edit-icon" aria-label={`Edit transaction for ${money(entry.amount)}`} onClick={() => onEdit(entry)}><Pencil size={14} aria-hidden="true" /></button>}</strong>
        </div>;
      })}
      {entries.length === 0 && <p className="empty-state">{emptyMessage}</p>}
    </div>
  );
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({
  parties,
  entries,
  canWriteTransactions,
  canViewParties,
}: {
  parties: Party[];
  entries: Entry[];
  canWriteTransactions: boolean;
  canViewParties: boolean;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [customFrom, setCustomFrom] = useState(() => currentBsRange("month").from);
  const [customTo, setCustomTo] = useState(() => todayDates().bs);
  const range = period === "custom"
    ? { from: customFrom, to: customTo }
    : currentBsRange(period === "lifetime" ? "month" : period);
  const invalidRange = period === "custom" && range.from > range.to;
  const periodEntries = period === "lifetime" ? entries : invalidRange ? [] : entries.filter(
    (entry) => entry.bs >= range.from && entry.bs <= range.to,
  );
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const sum = (source: Entry[], predicate: (entry: Entry, party?: Party) => boolean) =>
    source.reduce((total, entry) => predicate(entry, partyById.get(entry.partyId)) ? total + toCents(entry.amount) : total, 0) / 100;
  const sales = sum(periodEntries, (entry, party) => party?.partyType !== "supplier" && entry.type === "PURCHASE");
  const purchases = sum(periodEntries, (entry, party) => party?.partyType === "supplier" && entry.type === "PURCHASE");
  const collections = sum(periodEntries, (entry, party) => party?.partyType !== "supplier" && entry.type === "PAYMENT");
  const supplierPayments = sum(periodEntries, (entry, party) => party?.partyType === "supplier" && entry.type === "PAYMENT");
  const lifetimeBalances = balancesByParty(entries);
  const receivables = parties
    .map((party) => ({ party, balance: (lifetimeBalances.get(party.id) ?? 0) / 100 }))
    .filter(({ party, balance }) => party.partyType === "customer" && balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const payables = parties
    .map((party) => ({ party, balance: (lifetimeBalances.get(party.id) ?? 0) / 100 }))
    .filter(({ party, balance }) => party.partyType === "supplier" && balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const totalReceivables = receivables.reduce((total, item) => total + item.balance, 0);
  const totalPayables = payables.reduce((total, item) => total + item.balance, 0);
  const cashMovement = collections - supplierPayments;
  const salesAndPurchases = sales + purchases;
  const moneyInAndOut = collections + supplierPayments;
  const balancesDue = totalReceivables + totalPayables;
  const salesShare = salesAndPurchases ? Math.round(sales / salesAndPurchases * 100) : 0;
  const collectionShare = moneyInAndOut ? Math.round(collections / moneyInAndOut * 100) : 0;
  const receivableShare = balancesDue ? Math.round(totalReceivables / balancesDue * 100) : 0;
  const periodName = period === "custom" ? "Custom range" : period === "lifetime" ? "Lifetime" : `This ${period}`;
  const recentEntries = [...periodEntries].sort((a, b) => b.ad.localeCompare(a.ad)).slice(0, 6);

  return (
    <>
      <Header
        eyebrow="BUSINESS OVERVIEW"
        title="Dashboard"
        description="A clear view of revenue, spending, cash movement, and amounts due across the business."
        action={canWriteTransactions ? () => go("add-entry") : undefined}
        label="New transaction"
      />

      <section className="dashboard-filter" aria-label="Dashboard date range">
        <div className="period-tabs" role="group" aria-label="Date range preset">
          {(["week", "month", "year", "lifetime", "custom"] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={period === item ? "active" : ""}
              aria-pressed={period === item}
              onClick={() => setPeriod(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <span className="period-range">{period === "lifetime" ? "Lifetime · All recorded dates" : `${periodName} · ${range.from} to ${range.to} BS`}</span>
        {period === "custom" && (
          <div className="custom-range">
            <div><span>From (BS)</span><NepaliDatePicker value={customFrom} onChange={(bs) => setCustomFrom(bs)} /></div>
            <div><span>To (BS)</span><NepaliDatePicker value={customTo} onChange={(bs) => setCustomTo(bs)} /></div>
          </div>
        )}
        {invalidRange && <p className="range-error">The start date must be on or before the end date.</p>}
      </section>

      <section className="summary-grid dashboard-summary">
        <div>
          <span>Sold to customers</span>
          <strong>{money(sales)}</strong>
          <small>{periodName}</small>
        </div>
        <div>
          <span>Bought from suppliers</span>
          <strong>{money(purchases)}</strong>
          <small>{periodName}</small>
        </div>
        <div>
          <span>Money received</span>
          <strong>{money(collections)}</strong>
          <small>{periodName}</small>
        </div>
        <div>
          <span>Money paid out</span>
          <strong>{money(supplierPayments)}</strong>
          <small>{periodName}</small>
        </div>
      </section>

      <section className="analysis-charts" aria-label="Business charts">
        <article className="analysis-chart-card">
          <div className="analysis-chart-heading"><div><span className="eyebrow">TRADING ACTIVITY</span><h2>Sales compared with purchases</h2><p>How much was sold and bought in {periodName.toLowerCase()}.</p></div><strong className={sales - purchases < 0 ? "negative" : ""}>{sales - purchases < 0 ? "−" : "+"}{money(Math.abs(sales - purchases))}</strong></div>
          <div className="comparison-bars" role="img" aria-label={`Sales ${money(sales)} and purchases ${money(purchases)}`}>
            <div><span><i className="chart-dot sales" />Sales</span><b>{money(sales)}</b><em><i style={{ width: `${salesShare}%` }} /></em></div>
            <div><span><i className="chart-dot purchases" />Purchases</span><b>{money(purchases)}</b><em><i style={{ width: `${100 - salesShare}%` }} /></em></div>
          </div>
          <small className="chart-caption">Difference between sales and purchases</small>
        </article>

        <article className="analysis-chart-card">
          <div className="analysis-chart-heading"><div><span className="eyebrow">CASH MOVEMENT</span><h2>Money in compared with money out</h2><p>Payments received from customers and paid to suppliers.</p></div><strong className={cashMovement < 0 ? "negative" : ""}>{cashMovement < 0 ? "−" : "+"}{money(Math.abs(cashMovement))}</strong></div>
          <div className="comparison-bars" role="img" aria-label={`Money received ${money(collections)} and money paid ${money(supplierPayments)}`}>
            <div><span><i className="chart-dot received" />Received</span><b>{money(collections)}</b><em><i style={{ width: `${collectionShare}%` }} /></em></div>
            <div><span><i className="chart-dot paid" />Paid out</span><b>{money(supplierPayments)}</b><em><i style={{ width: `${100 - collectionShare}%` }} /></em></div>
          </div>
          <small className="chart-caption">Net money movement: customer payments minus supplier payments</small>
        </article>

        <article className="analysis-chart-card balance-chart-card">
          <div className="analysis-chart-heading"><div><span className="eyebrow">AMOUNTS STILL DUE</span><h2>Money to collect and pay</h2><p>Balances from all recorded transactions.</p></div></div>
          <div className="balance-chart-content">
            <div className="balance-donut" role="img" aria-label={`Customers owe ${money(totalReceivables)} and suppliers are owed ${money(totalPayables)}`} style={{ background: balancesDue ? `conic-gradient(#315f9f 0 ${receivableShare}%, #d89c75 ${receivableShare}% 100%)` : "#ececf0" }}><div><strong>{balancesDue ? `${receivableShare}%` : "—"}</strong><small>to collect</small></div></div>
            <div className="balance-key"><span><i className="chart-dot sales" />Customers owe you <b>{money(totalReceivables)}</b></span><span><i className="chart-dot paid" />You owe suppliers <b>{money(totalPayables)}</b></span></div>
          </div>
        </article>
      </section>

      <section className="business-health" aria-label="Business health overview">
        <div className="business-health-heading"><span className="eyebrow">BUSINESS POSITION</span><h2>What the business is owed and owes</h2><p>Balances are calculated from all recorded transactions.</p></div>
        <div className="business-health-metrics">
          <div><span>Customers owe you</span><strong>{money(totalReceivables)}</strong><small>{receivables.length} customer{receivables.length === 1 ? "" : "s"} with amounts due</small></div>
          <div><span>You owe suppliers</span><strong>{money(totalPayables)}</strong><small>{payables.length} supplier{payables.length === 1 ? "" : "s"} awaiting payment</small></div>
          <div><span>Net cash movement</span><strong className={cashMovement < 0 ? "negative" : ""}>{cashMovement < 0 ? "−" : "+"}{money(Math.abs(cashMovement))}</strong><small>Customer collections less supplier payments · {periodName}</small></div>
          <div><span>Active accounts</span><strong>{parties.length}</strong><small>{parties.filter((party) => party.partyType === "customer").length} customers · {parties.filter((party) => party.partyType === "supplier").length} suppliers</small></div>
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="reference-panel dashboard-recent">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                LATEST MOVEMENT
              </span>

              <h2>Recent transactions</h2>
            </div>

            <button
              className="text-link"
              onClick={() => go("transactions")}
            >
              View statement
              <ArrowRight size={14} />
            </button>
          </div>

          <Table
            entries={recentEntries}
            parties={parties}
            emptyMessage="No transactions recorded yet."
          />
        </section>

        <section className="reference-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                MONEY TO COLLECT
              </span>

              <h2>Customers who need to pay</h2>
            </div>

            {canViewParties && <button
               className="text-link"
               onClick={() => go("parties")}
            >
              View parties
              <ArrowRight size={14} />
            </button>}
          </div>

          {receivables.slice(0, 6).map(({ party, balance }) => (
              canViewParties ? <button
                className="outstanding-row"
                key={party.id}
                onClick={() =>
                  go(partyPath(party, parties))
                }
              >
                <span>
                  <strong>{party.name}</strong>
                  <small>{party.location}</small>
                </span>

                <b>
                  {money(balance)}
                </b>
              </button> : <div className="outstanding-row static" key={party.id}>
                <span><strong>{party.name}</strong><small>{party.location}</small></span>
                <b>{money(balance)}</b>
              </div>
            ))}
          {receivables.length === 0 && (
            <p className="empty-state">No customer balances are due.</p>
          )}
        </section>
        <section className="reference-panel dashboard-payables">
          <div className="panel-heading"><div><span className="eyebrow">MONEY TO PAY</span><h2>Suppliers you need to pay</h2></div></div>
          {payables.slice(0, 6).map(({ party, balance }) => canViewParties ? <button className="outstanding-row" key={party.id} onClick={() => go(partyPath(party, parties))}><span><strong>{party.name}</strong><small>{party.location}</small></span><b>{money(balance)}</b></button> : <div className="outstanding-row static" key={party.id}><span><strong>{party.name}</strong><small>{party.location}</small></span><b>{money(balance)}</b></div>)}
          {payables.length === 0 && <p className="empty-state">No supplier payments are due.</p>}
        </section>
      </div>
    </>
  );
}

/* =========================================================
   REPORTS
   ========================================================= */

function Reports({ parties, entries }: { parties: Party[]; entries: Entry[] }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [exporting, setExporting] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => currentBsRange("month").from);
  const [customTo, setCustomTo] = useState(() => todayDates().bs);
  const range = period === "custom" ? { from: customFrom, to: customTo } : currentBsRange(period === "lifetime" ? "month" : period);
  const invalidRange = period === "custom" && range.from > range.to;
  const reportEntries = period === "lifetime" ? entries : invalidRange ? [] : entries.filter((entry) => entry.bs >= range.from && entry.bs <= range.to);
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const customerSales = reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType !== "supplier" && entry.type === "PURCHASE");
  const supplierPurchases = reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType === "supplier" && entry.type === "PURCHASE");
  const customerPayments = reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType !== "supplier" && entry.type === "PAYMENT");
  const supplierPayments = reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType === "supplier" && entry.type === "PAYMENT");
  const sumAmount = (source: Entry[]) => source.reduce((sum, entry) => sum + entry.amount, 0);
  const sales = sumAmount(customerSales);
  const purchases = sumAmount(supplierPurchases);
  const collections = sumAmount(customerPayments);
  const payments = sumAmount(supplierPayments);
  const lifetimeBalances = balancesByParty(entries);
  const accountRows = parties.map((party) => {
    const partyEntries = reportEntries.filter((entry) => entry.partyId === party.id);
    const value = partyEntries.filter((entry) => entry.type === "PURCHASE").reduce((sum, entry) => sum + entry.amount, 0);
    const paid = partyEntries.filter((entry) => entry.type === "PAYMENT").reduce((sum, entry) => sum + entry.amount, 0);
    const transactionCount = partyEntries.length;
    const primaryCount = partyEntries.filter((entry) => entry.type === "PURCHASE").length;
    return { party, value, paid, transactionCount, averageValue: primaryCount ? value / primaryCount : 0, balance: (lifetimeBalances.get(party.id) ?? 0) / 100 };
  });
  const customers = accountRows.filter((row) => row.party.partyType === "customer" && row.transactionCount > 0).sort((a, b) => b.value - a.value || b.balance - a.balance);
  const suppliers = accountRows.filter((row) => row.party.partyType === "supplier" && row.transactionCount > 0).sort((a, b) => b.value - a.value || b.balance - a.balance);
  const customerDue = accountRows.filter((row) => row.party.partyType === "customer" && row.balance > 0).reduce((sum, row) => sum + row.balance, 0);
  const supplierDue = accountRows.filter((row) => row.party.partyType === "supplier" && row.balance > 0).reduce((sum, row) => sum + row.balance, 0);
  const collectionRate = sales ? Math.min(100, Math.round(collections / sales * 100)) : 0;
  const supplierPaymentRate = purchases ? Math.min(100, Math.round(payments / purchases * 100)) : 0;
  const periodName = period === "custom" ? "Custom range" : period === "lifetime" ? "Lifetime" : `This ${period}`;
  const largestEntry = [...reportEntries].sort((a, b) => b.amount - a.amount)[0];
  const largestSale = [...customerSales].sort((a, b) => b.amount - a.amount)[0];
  const largestPurchase = [...supplierPurchases].sort((a, b) => b.amount - a.amount)[0];
  const activeCustomers = new Set(reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType !== "supplier").map((entry) => entry.partyId)).size;
  const activeSuppliers = new Set(reportEntries.filter((entry) => partyById.get(entry.partyId)?.partyType === "supplier").map((entry) => entry.partyId)).size;
  const dailyActivity = Array.from(reportEntries.reduce((groups, entry) => {
    const current = groups.get(entry.bs) ?? { bs: entry.bs, sales: 0, purchases: 0, count: 0 };
    if (entry.type === "PURCHASE") {
      if (partyById.get(entry.partyId)?.partyType === "supplier") current.purchases += entry.amount;
      else current.sales += entry.amount;
    }
    current.count += 1;
    groups.set(entry.bs, current);
    return groups;
  }, new Map<string, { bs: string; sales: number; purchases: number; count: number }>()).values()).sort((a, b) => a.bs.localeCompare(b.bs)).slice(-12);
  const activityPeak = Math.max(1, ...dailyActivity.flatMap((day) => [day.sales, day.purchases]));
  const exportReport = async () => {
    setExporting(true);
    try {
      const [{ createLedgerExportPdf }, fontResponse] = await Promise.all([import("./lib/ledgerExportPdf"), fetch(statementFontUrl)]);
      if (!fontResponse.ok) throw new Error("Could not load the export font.");
      const pdf = await createLedgerExportPdf({
        title: "Business detailed report",
        period: period === "lifetime" ? "Lifetime - all recorded dates" : `${periodName} - ${range.from} to ${range.to} BS`,
        headers: ["Account type", "Party", "Sales / purchases", "Payments", "Average value", "Transactions", "Lifetime balance"],
        rows: accountRows.map((row) => [row.party.partyType === "supplier" ? "Supplier" : "Customer", row.party.name, money(row.value), money(row.paid), money(row.averageValue), String(row.transactionCount), money(row.balance)]),
      }, new Uint8Array(await fontResponse.arrayBuffer()));
      await downloadPdf(pdfFilename(`rkh-business-report-${period === "lifetime" ? "lifetime" : range.from}`), new Uint8Array(pdf));
    } finally {
      setExporting(false);
    }
  };

  return <>
    <Header eyebrow="BUSINESS REPORTS" title="Reports" description="Detailed reports for account performance, transaction patterns, and payment efficiency." action={exportReport} label={exporting ? "Preparing PDF..." : "Download PDF"} />
    <section className="dashboard-filter" aria-label="Report date range">
      <div className="period-tabs" role="group" aria-label="Report date range preset">{(["week", "month", "year", "lifetime", "custom"] as const).map((item) => <button type="button" key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <span className="period-range">{period === "lifetime" ? "Lifetime · All recorded dates" : `${periodName} · ${range.from} to ${range.to} BS`}</span>
      {period === "custom" && <div className="custom-range"><div><span>From (BS)</span><NepaliDatePicker value={customFrom} onChange={setCustomFrom} /></div><div><span>To (BS)</span><NepaliDatePicker value={customTo} onChange={setCustomTo} /></div></div>}
      {invalidRange && <p className="range-error">The start date must be on or before the end date.</p>}
    </section>
    <section className="report-kpis report-legacy-hidden" aria-hidden="true">
      <div><span>Total sales</span><strong>{money(sales)}</strong><small>Sold to customers · {periodName}</small></div>
      <div><span>Total purchases</span><strong>{money(purchases)}</strong><small>Bought from suppliers · {periodName}</small></div>
      <div><span>Cash received</span><strong>{money(collections)}</strong><small>Received from customers · {periodName}</small></div>
      <div><span>Cash paid</span><strong>{money(payments)}</strong><small>Paid to suppliers · {periodName}</small></div>
    </section>
    <section className="report-insights report-legacy-hidden" aria-hidden="true">
      <article><span className="eyebrow">COLLECTION PROGRESS</span><h2>Customer payments received</h2><strong>{collectionRate}%</strong><p>{money(collections)} received from {money(sales)} in sales during {periodName.toLowerCase()}.</p><div className="report-progress"><i style={{ width: `${collectionRate}%` }} /></div></article>
      <article><span className="eyebrow">PAYMENT PROGRESS</span><h2>Supplier payments made</h2><strong>{supplierPaymentRate}%</strong><p>{money(payments)} paid from {money(purchases)} in purchases during {periodName.toLowerCase()}.</p><div className="report-progress supplier"><i style={{ width: `${supplierPaymentRate}%` }} /></div></article>
      <article><span className="eyebrow">LIFETIME BALANCES</span><h2>Amounts still waiting</h2><div className="report-balance-pair"><span>Customers owe you <b>{money(customerDue)}</b></span><span>You owe suppliers <b>{money(supplierDue)}</b></span></div></article>
    </section>
    <section className="report-tables report-legacy-hidden" aria-hidden="true">
      <article className="reference-panel"><div className="panel-heading"><div><span className="eyebrow">CUSTOMER REPORT</span><h2>Top customers by sales</h2></div><button className="text-link" onClick={() => go("parties?type=customer")}>View customers <ArrowRight size={14} /></button></div><ReportRows rows={customers} parties={parties} type="customer" empty="No customer activity in this period." /></article>
      <article className="reference-panel"><div className="panel-heading"><div><span className="eyebrow">SUPPLIER REPORT</span><h2>Top suppliers by purchases</h2></div><button className="text-link" onClick={() => go("parties?type=supplier")}>View suppliers <ArrowRight size={14} /></button></div><ReportRows rows={suppliers} parties={parties} type="supplier" empty="No supplier activity in this period." /></article>
    </section>
    <section className="report-stat-grid" aria-label="Report summary">
      <div><span>Transactions recorded</span><strong>{reportEntries.length}</strong><small>{periodName}</small></div>
      <div><span>Average customer sale</span><strong>{money(customerSales.length ? sales / customerSales.length : 0)}</strong><small>Across {customerSales.length} sale{customerSales.length === 1 ? "" : "s"}</small></div>
      <div><span>Average supplier purchase</span><strong>{money(supplierPurchases.length ? purchases / supplierPurchases.length : 0)}</strong><small>Across {supplierPurchases.length} purchase{supplierPurchases.length === 1 ? "" : "s"}</small></div>
      <div><span>Largest transaction</span><strong>{largestEntry ? money(largestEntry.amount) : "—"}</strong><small>{largestEntry ? `${entryLabel(largestEntry, partyById.get(largestEntry.partyId))} · ${partyById.get(largestEntry.partyId)?.name ?? "Unknown party"}` : "No transactions"}</small></div>
      <div><span>Customers with activity</span><strong>{activeCustomers}</strong><small>Customers used in this period</small></div>
      <div><span>Suppliers with activity</span><strong>{activeSuppliers}</strong><small>Suppliers used in this period</small></div>
    </section>
    <section className="report-workspace">
      <article className="report-panel activity-timeline"><div className="report-panel-heading"><div><span className="eyebrow">ACTIVITY OVER TIME</span><h2>Sales and purchases by date</h2><p>Each pair of bars shows the amount recorded on that Nepali date.</p></div></div><div className="timeline-bars">{dailyActivity.map((day) => <div key={day.bs}><div className="timeline-values"><i className="sales" style={{ height: `${Math.max(3, day.sales / activityPeak * 100)}%` }} /><i className="purchases" style={{ height: `${Math.max(3, day.purchases / activityPeak * 100)}%` }} /></div><small>{day.bs.slice(5)}</small><em>{day.count}</em></div>)}{dailyActivity.length === 0 && <p className="empty-state">No activity in this date range.</p>}</div><div className="timeline-key"><span><i className="chart-dot sales" />Sales</span><span><i className="chart-dot purchases" />Purchases</span><span>Number = transactions on that date</span></div></article>
      <article className="report-panel report-efficiency"><div className="report-panel-heading"><div><span className="eyebrow">PAYMENT EFFICIENCY</span><h2>How quickly money moved</h2><p>These rates compare payments with sales and purchases recorded in the same date range.</p></div></div><div className="efficiency-item"><span>Customer sales collected</span><strong>{collectionRate}%</strong><div className="report-progress"><i style={{ width: `${collectionRate}%` }} /></div><small>{money(collections)} received from customer sales</small></div><div className="efficiency-item"><span>Supplier purchases paid</span><strong>{supplierPaymentRate}%</strong><div className="report-progress supplier"><i style={{ width: `${supplierPaymentRate}%` }} /></div><small>{money(payments)} paid against supplier purchases</small></div></article>
      <article className="report-panel report-largest"><div className="report-panel-heading"><div><span className="eyebrow">LARGEST RECORDS</span><h2>High-value transactions</h2></div></div><div className="largest-record"><span>Largest sale</span><strong>{largestSale ? money(largestSale.amount) : "—"}</strong><small>{largestSale ? partyById.get(largestSale.partyId)?.name : "No sales"}</small></div><div className="largest-record"><span>Largest purchase</span><strong>{largestPurchase ? money(largestPurchase.amount) : "—"}</strong><small>{largestPurchase ? partyById.get(largestPurchase.partyId)?.name : "No purchases"}</small></div><div className="largest-record"><span>Largest payment received</span><strong>{customerPayments.length ? money(Math.max(...customerPayments.map((entry) => entry.amount))) : "—"}</strong><small>Customer payment recorded</small></div><div className="largest-record"><span>Largest supplier payment</span><strong>{supplierPayments.length ? money(Math.max(...supplierPayments.map((entry) => entry.amount))) : "—"}</strong><small>Supplier payment recorded</small></div></article>
    </section>
    <section className="report-detail-panels">
      <article className="report-panel"><div className="report-panel-heading"><div><span className="eyebrow">CUSTOMER PERFORMANCE</span><h2>Customer sales report</h2><p>Sales, collections, average sale size, and transaction count for every active customer.</p></div><button className="text-link" onClick={() => go("parties?type=customer")}>View customers <ArrowRight size={14} /></button></div><ReportAccountTable rows={customers} parties={parties} type="customer" empty="No customer activity in this period." /></article>
      <article className="report-panel"><div className="report-panel-heading"><div><span className="eyebrow">SUPPLIER PERFORMANCE</span><h2>Supplier purchasing report</h2><p>Purchases, payments, average purchase size, and transaction count for every active supplier.</p></div><button className="text-link" onClick={() => go("parties?type=supplier")}>View suppliers <ArrowRight size={14} /></button></div><ReportAccountTable rows={suppliers} parties={parties} type="supplier" empty="No supplier activity in this period." /></article>
    </section>
  </>;
}

function ReportRows({ rows, parties, type, empty }: { rows: { party: Party; value: number; paid: number; balance: number }[]; parties: Party[]; type: "customer" | "supplier"; empty: string }) {
  return <div className="report-row-list">{rows.slice(0, 8).map((row) => <button key={row.party.id} type="button" onClick={() => go(partyPath(row.party, parties))}><span><strong>{row.party.name}</strong><small>{type === "customer" ? "Sales" : "Purchases"}: {money(row.value)} · {type === "customer" ? "Received" : "Paid"}: {money(row.paid)}</small></span><b className={row.balance > 0 ? "due" : ""}>{row.balance > 0 ? (type === "customer" ? "To collect " : "To pay ") : "Balance "}{money(Math.abs(row.balance))}</b></button>)}{rows.length === 0 && <p className="empty-state">{empty}</p>}</div>;
}

function ReportAccountTable({ rows, parties, type, empty }: { rows: { party: Party; value: number; paid: number; transactionCount: number; averageValue: number; balance: number }[]; parties: Party[]; type: "customer" | "supplier"; empty: string }) {
  const primary = type === "customer" ? "Sales" : "Purchases";
  const payment = type === "customer" ? "Received" : "Paid";
  return <div className="report-account-table"><div className="report-account-head"><span>PARTY</span><span>{primary.toUpperCase()}</span><span>{payment.toUpperCase()}</span><span>AVERAGE</span><span>COUNT</span></div>{rows.map((row) => <button key={row.party.id} type="button" onClick={() => go(partyPath(row.party, parties))}><span><strong>{row.party.name}</strong><small>{row.party.company || row.party.location || "Party account"}</small></span><b>{money(row.value)}</b><b>{money(row.paid)}</b><b>{money(row.averageValue)}</b><b>{row.transactionCount}</b></button>)}{rows.length === 0 && <p className="empty-state">{empty}</p>}</div>;
}

/* =========================================================
   PARTIES
   ========================================================= */

function Parties({
  parties,
  entries,
}: {
  parties: Party[];
  entries: Entry[];
}) {
  const [query, setQuery] = useState("");
  const [partyType, setPartyType] = useState<Party["partyType"]>(() => new URLSearchParams(window.location.search).get("type") === "supplier" ? "supplier" : "customer");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  const filteredParties = parties.filter((party) => party.partyType === partyType);
  const matches = query.trim() ? matchingParties(filteredParties, query).slice(0, 6) : [];
  const showSuggestions = suggestionsOpen && Boolean(query.trim());

  const shown = matchingParties(filteredParties, query);
  const partyBalances = balancesByParty(entries);

  return (
    <>
      <Header
        eyebrow="DIRECTORY"
        title="Parties"
        description="Manage your customer and supplier accounts."
        action={() => go("add-party")}
        label="Add party"
      />

      <div className="party-type-tabs" role="group" aria-label="Party type">
        <button type="button" className={partyType === "customer" ? "active" : ""} aria-pressed={partyType === "customer"} onClick={() => { setPartyType("customer"); setVisibleCount(LIST_PAGE_SIZE); setSuggestionsOpen(false); }}>Customers <span>{parties.filter((party) => party.partyType === "customer").length}</span></button>
        <button type="button" className={partyType === "supplier" ? "active" : ""} aria-pressed={partyType === "supplier"} onClick={() => { setPartyType("supplier"); setVisibleCount(LIST_PAGE_SIZE); setSuggestionsOpen(false); }}>Suppliers <span>{parties.filter((party) => party.partyType === "supplier").length}</span></button>
      </div>

      <div className="filter-bar directory-search-bar">
        <div className="party-search-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSuggestionsOpen(false); }}>
          <Search size={17} aria-hidden="true" />
          <input
            ref={searchRef}
            role="combobox"
            aria-label="Search parties"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="directory-party-suggestions"
            aria-activedescendant={showSuggestions && matches.length ? `directory-party-suggestions-${activeSuggestion}` : undefined}
            placeholder="Search by name, company, or phone"
            value={query}
            onFocus={() => setSuggestionsOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(LIST_PAGE_SIZE); setActiveSuggestion(0); setSuggestionsOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSuggestionsOpen(false);
              if (!showSuggestions || matches.length === 0) return;
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion((index) => (index + 1) % matches.length); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion((index) => (index - 1 + matches.length) % matches.length); }
              if (event.key === "Enter") { event.preventDefault(); const match = matches[activeSuggestion]; if (match) go(partyPath(match, parties)); }
            }}
          />
          {query && <button type="button" className="party-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); setVisibleCount(LIST_PAGE_SIZE); setSuggestionsOpen(false); setActiveSuggestion(0); searchRef.current?.focus(); }}><X size={15} /></button>}
          {showSuggestions && <PartySuggestions id="directory-party-suggestions" parties={matches} active={activeSuggestion} onSelect={(party) => go(partyPath(party, parties))} emptyMessage="No matching parties." />}
        </div>
      </div>

      <section className="reference-panel table-panel">
        <div className="party-row party-head">
          <span>PARTY</span>
          <span>CONTACT</span>
          <span>LOCATION</span>
          <span>BALANCE</span>
          <span />
        </div>

        {shown.slice(0, visibleCount).map((party) => {
          const balance = (partyBalances.get(party.id) ?? 0) / 100;

          return (
            <button
              className="party-row party-button"
              key={party.id}
              onClick={() =>
                go(partyPath(party, parties))
              }
            >
              <span>
                <b>{party.name}</b>
                <small>{party.company}</small>
              </span>

              <span>{party.contact || "—"}</span>

              <span>{party.location || "—"}</span>

              <strong
                className={
                  balance > 0
                    ? "balance-due"
                    : "balance-clear"
                }
              >
                {balance > 0
                  ? money(balance)
                  : balance < 0
                    ? `Advance ${money(Math.abs(balance))}`
                    : "Settled"}
              </strong>

              <ArrowRight size={15} />
            </button>
          );
        })}
        {shown.length === 0 && (
          <p className="empty-state">
            {query ? `No ${partyType}s match your search.` : `No ${partyType}s yet. Add a ${partyType} to get started.`}
          </p>
        )}
        {shown.length > visibleCount && <button type="button" className="list-load-more" onClick={() => setVisibleCount((count) => count + LIST_PAGE_SIZE)}>Show more parties ({shown.length - visibleCount} remaining)</button>}
      </section>
    </>
  );
}

/* =========================================================
   FORM FIELD
   ========================================================= */

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

const pdfFilename = (name: string) => `${name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").toLowerCase() || "rkh-export"}.pdf`;

function PartyTypePicker({
  value,
  onChange,
}: {
  value: Party["partyType"];
  onChange: (value: Party["partyType"]) => void;
}) {
  return (
    <div className="party-type-picker" role="radiogroup" aria-label="Party type">
      {(["customer", "supplier"] as const).map((partyType) => {
        const selected = value === partyType;
        return (
          <label key={partyType} className={selected ? "selected" : ""}>
            <input type="radio" name="party-type" value={partyType} checked={selected} onChange={() => onChange(partyType)} />
            <span className="party-type-check" aria-hidden="true"><Check size={13} /></span>
            <span>{partyType === "customer" ? "Customer" : "Supplier"}</span>
          </label>
        );
      })}
    </div>
  );
}

function TransactionTypePicker({ value, isSupplier, onChange }: {
  value: EntryType;
  isSupplier: boolean;
  onChange: (value: EntryType) => void;
}) {
  const options = [
    { type: "PURCHASE" as const, title: isSupplier ? "Purchase" : "Sale", help: isSupplier ? "Goods bought from a supplier" : "Goods sold to a customer", Icon: FileText },
    { type: "PAYMENT" as const, title: isSupplier ? "Payment made" : "Payment received", help: isSupplier ? "Money paid to a supplier" : "Money collected from a customer", Icon: ArrowRight },
  ];
  return <div className="transaction-type-picker" role="radiogroup" aria-label="Transaction type">
    {options.map(({ type, title, help, Icon }) => <label key={type} className={value === type ? "selected" : ""}>
      <input type="radio" name="transaction-type" value={type} checked={value === type} onChange={() => onChange(type)} />
      <span className="transaction-type-icon"><Icon size={18} /></span>
      <span className="transaction-type-copy"><strong>{title}</strong><small>{help}</small></span>
      <span className="transaction-type-check"><Check size={14} /></span>
    </label>)}
  </div>;
}

/* =========================================================
   ADD PARTY
   ========================================================= */

function AddParty({
  save,
}: {
  save: (
    party: Omit<Party, "id">,
  ) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    partyType: "customer" as Party["partyType"],
    name: "",
    company: "",
    contact: "",
    location: "",
    notes: "",
  });

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!form.name.trim()) {
      return;
    }

    if (!partyPhoneIsValid(form.contact)) {
      setError("Contact number must be exactly 10 digits.");
      return;
    }

    setSaving(true);
    setError("");

    const success = await save(form);

    setSaving(false);

    if (success) {
      go(`parties?type=${form.partyType}`);
    } else {
      setError(
        "Could not save party. Please try again.",
      );
    }
  };

  return (
    <>
      <Header
        eyebrow="PARTIES / NEW"
        title="Add party"
        description="Create a customer or supplier account."
        action={() => go("parties")}
        label="Back to parties"
      />

      <form
        className="form-panel party-form"
        onSubmit={submit}
      >
        <div className="form-panel-heading"><span className="form-kicker">NEW ACCOUNT</span><h2>Party information</h2><p>Choose the account type, then add the details your team will recognize.</p></div>

        <div className="form-grid">
          <div className="form-step-heading"><span>1</span><div><strong>Account identity</strong><small>Names help your team find the right ledger later.</small></div></div>
          <div className="form-field">
            <span>Party type *</span>
            <PartyTypePicker value={form.partyType} onChange={(partyType) => setForm({ ...form, partyType })} />
          </div>
          <FormField label="Party name *">
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({
                  ...form,
                  name: event.target.value,
                })
              }
              placeholder="Full name or business name"
            />
          </FormField>

          <FormField label="Company name">
            <input
              value={form.company}
              onChange={(event) =>
                setForm({
                  ...form,
                  company: event.target.value,
                })
              }
            />
          </FormField>

          <FormField label="Contact number">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={form.contact}
              onChange={(event) =>
                setForm({
                  ...form,
                  contact: event.target.value.replace(/\D/g, "").slice(0, 10),
                })
              }
              placeholder="10-digit phone number"
            />
            <small>Enter exactly 10 digits if adding a contact number.</small>
          </FormField>

          <FormField label="Location">
            <input
              value={form.location}
              onChange={(event) =>
                setForm({
                  ...form,
                  location: event.target.value,
                })
              }
              placeholder="City or area"
            />
          </FormField>
        </div>

        <div className="form-step-heading form-optional-heading"><span>2</span><div><strong>Extra context</strong><small>Optional notes stay with this party.</small></div></div>
        <FormField label="Notes">
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm({
                ...form,
                notes: event.target.value,
              })
            }
          />
        </FormField>

        {error && (
          <p className="form-error" role="alert">{error}</p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="outline-button"
            onClick={() => go("parties")}
          >
            Cancel
          </button>

          <button
            className="black-button"
            disabled={saving}
          >
            <Check size={15} />

            {saving
              ? "Saving party..."
              : "Add party"}
          </button>
        </div>
      </form>
    </>
  );
}

/* =========================================================
   ADD ENTRY
   ========================================================= */

function AddEntry({
  parties,
  initialPartyId,
  save,
}: {
  parties: Party[];
  initialPartyId: string;
  save: (
    entry: Omit<Entry, "id"> & { paidNow?: number },
  ) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    partyId: initialPartyId,
    type: "PURCHASE" as EntryType,
    amount: "",
    paidNow: "",
    ...todayDates(),
    description: "",
  });

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [dateError, setDateError] = useState("");

  const [partiallyPaid, setPartiallyPaid] = useState(false);
  const [counterpartyType, setCounterpartyType] = useState<Party["partyType"]>(
    () => parties.find((party) => party.id === initialPartyId)?.partyType ?? "customer",
  );
  const [partyQuery, setPartyQuery] = useState(() => parties.find((party) => party.id === initialPartyId)?.name ?? "");
  const [partySuggestionsOpen, setPartySuggestionsOpen] = useState(false);
  const [activePartySuggestion, setActivePartySuggestion] = useState(0);
  const isSupplier = counterpartyType === "supplier";
  const primaryTransactionLabel = isSupplier ? "Purchase" : "Sale";
  const paymentTransactionLabel = isSupplier ? "Payment made" : "Payment received";
  const eligibleParties = parties.filter((party) => party.partyType === counterpartyType);
  const partyMatches = [...(partyQuery.trim() ? matchingParties(eligibleParties, partyQuery) : eligibleParties)]
    .sort((a, b) => {
      const query = partyQuery.trim().toLowerCase();
      const rank = (party: Party) => party.name.toLowerCase().startsWith(query) ? 0 : party.name.toLowerCase().includes(query) ? 1 : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    })
    .slice(0, 6);
  const showPartySuggestions = partySuggestionsOpen && !(form.partyId && partyQuery === parties.find((party) => party.id === form.partyId)?.name);
  const chooseParty = (party: Party) => {
    setForm((current) => ({ ...current, partyId: party.id, paidNow: "" }));
    setPartyQuery(party.name);
    setPartiallyPaid(false);
    setPartySuggestionsOpen(false);
    setActivePartySuggestion(0);
    setError("");
  };

  const changeEnglishDate = (value: string) => {
    if (!value) {
      setForm((current) => ({ ...current, ad: "" }));
      setDateError("Choose a valid English date.");
      return;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      setDateError("Choose a valid English date.");
      setForm((current) => ({ ...current, ad: value }));
      return;
    }
    try {
      const bs = new NepaliDate(date).format("YYYY-MM-DD");
      setForm((current) => ({ ...current, ad: value, bs }));
      setDateError("");
    } catch {
      setForm((current) => ({ ...current, ad: value }));
      setDateError("This English date is outside the supported Nepali calendar range.");
    }
  };

  const purchaseCents = parseMoneyCents(form.amount) ?? 0;
  const paidNowCents = partiallyPaid ? parseMoneyCents(form.paidNow) ?? 0 : 0;
  const remainingCents = Math.max(0, purchaseCents - paidNowCents);
  const invalidPaidNow = form.type === "PURCHASE" && partiallyPaid && (paidNowCents <= 0 || paidNowCents >= purchaseCents);

  const submit = async (
    event: FormEvent,
  ) => {
    event.preventDefault();

    if (!form.partyId) {
      setError("Select a party from the suggestions.");
      return;
    }

    if (dateError) {
      setError(dateError);
      return;
    }

    if (
      purchaseCents <= 0 ||
      !form.bs ||
      !form.ad
    ) {
      setError("Enter a valid amount with no more than two decimal places.");
      return;
    }

    if (invalidPaidNow) {
      setError(`Enter a partial payment greater than zero and less than the ${primaryTransactionLabel.toLowerCase()} total.`);
      return;
    }

    setSaving(true);
    setError("");

    const success = await save({
      partyId: form.partyId,
      type: form.type,
      amount: purchaseCents / 100,
      paidNow: form.type === "PURCHASE" && partiallyPaid ? paidNowCents / 100 : 0,
      ad: form.ad,
      bs: form.bs,
      description: form.description,
    });

    setSaving(false);

    if (success) {
      go("transactions");
    } else {
      setError(
        "Could not save transaction. Please try again.",
      );
    }
  };

  return (
    <>
      <Header
        eyebrow="TRANSACTIONS / NEW"
        title="New transaction"
        description="Record sales, purchases, customer collections, and supplier payments. Balances update automatically."
        action={() => go("transactions")}
        label="View transactions"
      />

      <form
        className="form-panel transaction-form"
        onSubmit={submit}
      >
        <div className="form-panel-heading"><span className="form-kicker">NEW LEDGER ENTRY</span><h2>Transaction details</h2><p>Follow these steps to record the right account and amount.</p></div>

        {parties.length === 0 && (
          <div className="form-notice">
            Add a party before recording a transaction.
            <button type="button" className="text-link" onClick={() => go("add-party")}>Add party <ArrowRight size={14} /></button>
          </div>
        )}

        <div className="form-grid transaction-form-grid">
          <div className="form-step-heading"><span>1</span><div><strong>Choose an account</strong><small>Select the customer or supplier this entry belongs to.</small></div></div>
          <div className="form-field">
            <span>Party type *</span>
            <PartyTypePicker
              value={counterpartyType}
              onChange={(nextType) => {
                setCounterpartyType(nextType);
                setForm((current) => ({ ...current, partyId: "", paidNow: "" }));
                setPartyQuery("");
                setPartiallyPaid(false);
                setPartySuggestionsOpen(false);
                setActivePartySuggestion(0);
              }}
            />
          </div>

          <div className="form-field">
            <label htmlFor="entry-party-search">Party *</label>
            <div className="entry-party-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setPartySuggestionsOpen(false); }}>
              <input
                id="entry-party-search"
                role="combobox"
                aria-required="true"
                aria-autocomplete="list"
                aria-expanded={showPartySuggestions}
                aria-controls="entry-party-suggestions"
                aria-activedescendant={showPartySuggestions && partyMatches.length ? `entry-party-suggestions-${activePartySuggestion}` : undefined}
                autoComplete="off"
                placeholder={`Type a ${isSupplier ? "supplier" : "customer"} name, company, or phone`}
                value={partyQuery}
                onFocus={() => setPartySuggestionsOpen(true)}
                onChange={(event) => { setPartyQuery(event.target.value); setForm((current) => ({ ...current, partyId: "" })); setActivePartySuggestion(0); setPartySuggestionsOpen(true); }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { setPartySuggestionsOpen(false); return; }
                  if (!showPartySuggestions || !partyMatches.length) return;
                  if (event.key === "ArrowDown") { event.preventDefault(); setActivePartySuggestion((index) => (index + 1) % partyMatches.length); }
                  if (event.key === "ArrowUp") { event.preventDefault(); setActivePartySuggestion((index) => (index - 1 + partyMatches.length) % partyMatches.length); }
                  if (event.key === "Enter") { event.preventDefault(); chooseParty(partyMatches[activePartySuggestion]); }
                }}
              />
              <small className="entry-party-help">Showing {isSupplier ? "suppliers" : "customers"} only. Change Party type to switch.</small>
              {partyQuery && <button type="button" className="party-search-clear" aria-label="Clear selected party" onClick={() => { setPartyQuery(""); setForm((current) => ({ ...current, partyId: "" })); setActivePartySuggestion(0); setPartySuggestionsOpen(true); document.getElementById("entry-party-search")?.focus(); }}><X size={15} /></button>}
              {showPartySuggestions && <PartySuggestions id="entry-party-suggestions" parties={partyMatches} active={activePartySuggestion} onSelect={chooseParty} emptyMessage="No matching parties. Try a different name or phone number." />}
            </div>
          </div>

          <div className="form-step-heading"><span>2</span><div><strong>Record the activity</strong><small>Choose what happened, then enter the amount in rupees.</small></div></div>
          <div className="form-field transaction-type-field"><span>Transaction type *</span>
            <TransactionTypePicker value={form.type} isSupplier={isSupplier} onChange={(type) => {
                setForm({ ...form, type, paidNow: "" });
                setPartiallyPaid(false);
              }} />
          </div>

          <div className="amount-column">
            <FormField label={form.type === "PURCHASE" ? `${primaryTransactionLabel} total (NPR) *` : "Payment amount (NPR) *"}>
              <span className="money-input"><span>NPR</span><input
                required
                type="text"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,2})?"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                placeholder="0.00"
              /></span>
            </FormField>

            {form.type === "PURCHASE" && (
              <>
                <label className="partial-toggle">
                  <input
                    type="checkbox"
                    checked={partiallyPaid}
                    onChange={(event) => {
                      setPartiallyPaid(event.target.checked);
                      if (!event.target.checked) setForm({ ...form, paidNow: "" });
                    }}
                  />
                  <span>{isSupplier ? "Partially paid" : "Partially received"}</span>
                </label>
                {partiallyPaid && (
                  <FormField label={`${paymentTransactionLabel} now (NPR) *`}>
                    <span className="money-input"><span>NPR</span><input
                      required
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,2})?"
                      value={form.paidNow}
                      onChange={(event) => setForm({ ...form, paidNow: event.target.value })}
                      placeholder="0.00"
                    /></span>
                    <small>{isSupplier ? "Enter the amount paid now. The remaining amount stays payable." : "Enter the amount received now. The remaining amount stays receivable."}</small>
                    {form.paidNow && invalidPaidNow && <small className="field-error">Enter less than the {primaryTransactionLabel.toLowerCase()} total.</small>}
                  </FormField>
                )}
              </>
            )}
          </div>

          <div className="form-step-heading"><span>3</span><div><strong>Date and details</strong><small>Keep the Nepali and English dates in sync, then add a useful note.</small></div></div>
          <div className="transaction-date-column">
            <div className="form-field">
              <span>Nepali date (BS) *</span>
              <NepaliDatePicker
                value={form.bs}
                onChange={(bs, ad) => { setForm((current) => ({ ...current, bs, ad })); setDateError(""); }}
              />
              <small>Select a date from the Nepali calendar.</small>
            </div>
            <FormField label="English date (AD) *">
              <EnglishDatePicker value={form.ad} onChange={changeEnglishDate} />
              <small>Changing either date updates the other automatically.</small>
              {dateError && <small className="field-error" role="alert">{dateError}</small>}
            </FormField>
          </div>

        </div>

        {form.type === "PURCHASE" && purchaseCents > 0 && (
          <div className="payment-preview" aria-live="polite">
            <div><span>{primaryTransactionLabel} total</span><strong>{money(purchaseCents / 100)}</strong></div>
            <div><span>{isSupplier ? "Paid now" : "Received now"}</span><strong>{money(paidNowCents / 100)}</strong></div>
            <div><span>Remaining from this {primaryTransactionLabel.toLowerCase()}</span><strong>{money(remainingCents / 100)}</strong></div>
          </div>
        )}

        <FormField label="Description">
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({
                ...form,
                description:
                  event.target.value,
              })
            }
            placeholder={isSupplier ? "What was purchased or paid?" : "What was sold or received?"}
          />
        </FormField>

        {error && (
          <p className="form-error">{error}</p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="outline-button"
            onClick={() =>
              go("transactions")
            }
          >
            Cancel
          </button>

          <button
            className="black-button"
            disabled={saving || invalidPaidNow}
          >
            <Check size={15} />

            {saving
              ? "Saving transaction..."
              : "Save transaction"}
          </button>
        </div>
      </form>
    </>
  );
}

/* =========================================================
   TRANSACTIONS
   ========================================================= */

function Transactions({
  parties,
  entries,
  canWriteTransactions,
}: {
  parties: Party[];
  entries: Entry[];
  canWriteTransactions: boolean;
}) {
  const [query, setQuery] =
    useState("");

  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [type, setType] =
    useState("all");

  const [from, setFrom] =
    useState("");

  const [to, setTo] =
    useState("");

  const suggestedParties = query.trim() && !selectedPartyId
    ? matchingParties(parties, query).slice(0, 6)
    : [];
  const showSuggestions = suggestionsOpen && Boolean(query.trim()) && !selectedPartyId;
  const chooseParty = (party: Party) => {
    setQuery(party.name);
    setSelectedPartyId(party.id);
    setVisibleCount(LIST_PAGE_SIZE);
    setSuggestionsOpen(false);
    setActiveSuggestion(0);
  };

  const partyById = new Map(parties.map((party) => [party.id, party]));
  const shown = entries.filter(
    (entry) => {
      const party = partyById.get(entry.partyId);

      const text =
        `${party?.name ?? ""} ${
          party?.company ?? ""
        } ${entryDescription(entry)}`.toLowerCase();

      return (
        (selectedPartyId ? entry.partyId === selectedPartyId : !query ||
          text.includes(
            query.toLowerCase(),
          )) &&
        (type === "all" ||
          type === entry.type) &&
        (!from ||
          entry.bs >= from) &&
        (!to || entry.bs <= to)
      );
    },
  );

  const exportStatement = async () => {
    if (!shown.length) return;
    setExporting(true);
    try {
      const [{ createLedgerExportPdf }, fontResponse] = await Promise.all([import("./lib/ledgerExportPdf"), fetch(statementFontUrl)]);
      if (!fontResponse.ok) throw new Error("Could not load the export font.");
      const primaryEntries = shown.filter((entry) => entry.type === "PURCHASE").reduce((sum, entry) => sum + toCents(entry.amount), 0) / 100;
      const payments = shown.filter((entry) => entry.type === "PAYMENT").reduce((sum, entry) => sum + toCents(entry.amount), 0) / 100;
      const pdf = await createLedgerExportPdf({
        title: "Transaction statement",
        period: from || to ? `${from || "Beginning"} to ${to || todayDates().bs} BS` : "All current statement results",
        headers: ["Date (BS)", "Date (AD)", "Party", "Type", "Description", "Sales / purchases", "Payments"],
        rows: [
          ...shown.map((entry) => [entry.bs, entry.ad, partyName(parties, entry.partyId), entryLabel(entry, partyById.get(entry.partyId)), entryDescription(entry), entry.type === "PURCHASE" ? money(entry.amount) : "", entry.type === "PAYMENT" ? money(entry.amount) : ""]),
          ["TOTAL", "", "", "", "", money(primaryEntries), money(payments)],
        ],
      }, new Uint8Array(await fontResponse.arrayBuffer()));
      await downloadPdf(pdfFilename(`rkh-transaction-statement-${todayDates().bs}`), new Uint8Array(pdf));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Header
        eyebrow="LEDGER / STATEMENT"
        title="Statement"
        description="Review sales and payments. Filter the list or export the current results."
        action={canWriteTransactions ? () => go("add-entry") : undefined}
        label="New transaction"
      />

      <div className="transaction-actions">
        <button
          className="outline-button"
          disabled={shown.length === 0 || exporting}
          onClick={exportStatement}
        >
          <Download size={15} />
          {exporting ? "Preparing PDF..." : "Download PDF"}
        </button>
      </div>

      <div className="filter-bar transaction-filters">
        <div className="party-search-field" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSuggestionsOpen(false); }}>
          <Search size={17} aria-hidden="true" />
          <input
            ref={searchRef}
            role="combobox"
            aria-label="Search parties or descriptions"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="party-suggestions"
            aria-activedescendant={showSuggestions && suggestedParties.length ? `party-suggestions-${activeSuggestion}` : undefined}
            placeholder="Search party or description"
            value={query}
            onFocus={() => setSuggestionsOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSelectedPartyId(null); setVisibleCount(LIST_PAGE_SIZE); setActiveSuggestion(0); setSuggestionsOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSuggestionsOpen(false);
              if (!showSuggestions || suggestedParties.length === 0) return;
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion((index) => (index + 1) % suggestedParties.length); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion((index) => (index - 1 + suggestedParties.length) % suggestedParties.length); }
              if (event.key === "Enter") { event.preventDefault(); const match = suggestedParties[activeSuggestion]; if (match) chooseParty(match); }
            }}
          />
          {query && <button type="button" className="party-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); setSelectedPartyId(null); setVisibleCount(LIST_PAGE_SIZE); setSuggestionsOpen(false); setActiveSuggestion(0); searchRef.current?.focus(); }}><X size={15} /></button>}
          {showSuggestions && <PartySuggestions id="party-suggestions" parties={suggestedParties} active={activeSuggestion} onSelect={chooseParty} emptyMessage="No matching parties. You can still search descriptions." />}
        </div>

        <select
          aria-label="Filter transaction type"
          value={type}
          onChange={(event) => { setType(event.target.value); setVisibleCount(LIST_PAGE_SIZE); }}
        >
          <option value="all">
            All types
          </option>

          <option value="PURCHASE">
            Sales & purchases
          </option>

          <option value="PAYMENT">
            Payments received & paid
          </option>
        </select>

        <input
          aria-label="From Nepali date"
          placeholder="From BS (YYYY-MM-DD)"
          value={from}
          onChange={(event) => { setFrom(event.target.value); setVisibleCount(LIST_PAGE_SIZE); }}
        />

        <input
          aria-label="To Nepali date"
          placeholder="To BS (YYYY-MM-DD)"
          value={to}
          onChange={(event) => { setTo(event.target.value); setVisibleCount(LIST_PAGE_SIZE); }}
        />
      </div>

      <section className="reference-panel table-panel">
        <Table
          entries={shown.slice(0, visibleCount)}
          parties={parties}
          emptyMessage={entries.length === 0 ? "No transactions yet. Add a transaction to start your ledger." : "No transactions match these filters."}
        />
        {shown.length > visibleCount && <button type="button" className="list-load-more" onClick={() => setVisibleCount((count) => count + LIST_PAGE_SIZE)}>Show more transactions ({shown.length - visibleCount} remaining)</button>}
      </section>
    </>
  );
}

/* =========================================================
   EDIT PARTY
   ========================================================= */

function EditParty({
  party,
  parties,
  save,
}: {
  party: Party;
  parties: Party[];
  save: (
    party: Party,
  ) => Promise<boolean>;
}) {
  const [form, setForm] =
    useState(party);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const submit = async (
    event: FormEvent,
  ) => {
    event.preventDefault();

    if (!form.name.trim()) {
      return;
    }

    if (!partyPhoneIsValid(form.contact ?? "")) {
      setError("Contact number must be exactly 10 digits.");
      return;
    }

    setSaving(true);
    setError("");

    const success =
      await save(form);

    setSaving(false);

    if (success) {
      go(partyPath(form, parties.map((item) => item.id === form.id ? form : item)));
    } else {
      setError(
        "Could not update party.",
      );
    }
  };

  return (
    <>
      <Header
        eyebrow="PARTIES / EDIT"
        title="Edit party"
        description="Update this party's type and contact details."
        action={() =>
          go(partyPath(party, parties))
        }
        label="Back to party"
      />

      <form
        className="form-panel party-form"
        onSubmit={submit}
      >
        <div className="form-panel-heading"><span className="form-kicker">EDIT ACCOUNT</span><h2>Party information</h2><p>Update the details used throughout this party's ledger.</p></div>

        <div className="form-grid">
          <div className="form-step-heading"><span>1</span><div><strong>Account identity</strong><small>Review the type, name, and contact details.</small></div></div>
          <div className="form-field">
            <span>Party type *</span>
            <PartyTypePicker value={form.partyType} onChange={(partyType) => setForm({ ...form, partyType })} />
          </div>
          <FormField label="Party name *">
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({
                  ...form,
                  name: event.target.value,
                })
              }
            />
          </FormField>

          <FormField label="Company name">
            <input
              value={
                form.company || ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  company:
                    event.target.value,
                })
              }
            />
          </FormField>

          <FormField label="Contact number">
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={
                form.contact || ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  contact:
                    event.target.value.replace(/\D/g, "").slice(0, 10),
                })
              }
              placeholder="10-digit phone number"
            />
            <small>Enter exactly 10 digits if adding a contact number.</small>
          </FormField>

          <FormField label="Location">
            <input
              value={
                form.location || ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  location:
                    event.target.value,
                })
              }
            />
          </FormField>
        </div>

        <div className="form-step-heading form-optional-heading"><span>2</span><div><strong>Extra context</strong><small>Optional notes stay with this party.</small></div></div>
        <FormField label="Notes">
          <textarea
            value={form.notes || ""}
            onChange={(event) =>
              setForm({
                ...form,
                notes: event.target.value,
              })
            }
          />
        </FormField>

        {error && (
          <p className="form-error" role="alert">{error}</p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="outline-button"
            onClick={() =>
              go(partyPath(party, parties))
            }
          >
            Cancel
          </button>

          <button
            className="black-button"
            disabled={saving}
          >
            <Check size={15} />

            {saving
              ? "Saving changes..."
              : "Save changes"}
          </button>
        </div>
      </form>
    </>
  );
}

/* =========================================================
   PARTY DETAIL
   ========================================================= */

function EditTransaction({ entry, party, onClose, onSave }: { entry: Entry; party: Party; onClose: () => void; onSave: (entry: Entry) => Promise<boolean> }) {
  const [form, setForm] = useState(entry);
  const [amount, setAmount] = useState(entry.amount.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changeEnglishDate = (ad: string) => {
    const [year, month, day] = ad.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (!ad || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) { setError("Choose a valid English date."); return; }
    try { setForm((current) => ({ ...current, ad, bs: new NepaliDate(date).format("YYYY-MM-DD") })); setError(""); } catch { setError("This date is outside the supported Nepali calendar range."); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoneyCents(amount);
    if (!cents || cents <= 0) { setError("Enter a valid amount with no more than two decimal places."); return; }
    setSaving(true); setError("");
    const saved = await onSave({ ...form, amount: cents / 100, description: form.description.trim() });
    setSaving(false);
    if (!saved) setError("Could not save this transaction. Please try again.");
  };
  const label = entry.type === "PAYMENT" ? (party.partyType === "supplier" ? "Payment made" : "Payment received") : party.partyType === "supplier" ? "Purchase" : "Sale";
  return createPortal(<div className="profile-modal-backdrop transaction-edit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="profile-modal transaction-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title"><div className="profile-modal-head"><div><span className="eyebrow">EDIT TRANSACTION</span><h2 id="edit-transaction-title">{label}</h2></div><button type="button" aria-label="Close transaction editor" onClick={onClose} disabled={saving}><X size={18} /></button></div><p className="transaction-edit-party">{party.name}</p><form onSubmit={submit}><FormField label="Amount (NPR) *"><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></FormField><div className="transaction-edit-dates"><div className="form-field"><span>Nepali date (BS) *</span><NepaliDatePicker value={form.bs} onChange={(bs, ad) => { setForm((current) => ({ ...current, bs, ad })); setError(""); }} /></div><FormField label="English date (AD) *"><EnglishDatePicker value={form.ad} onChange={changeEnglishDate} /></FormField></div><FormField label="Description"><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></FormField>{error && <p className="form-error" role="alert">{error}</p>}<div className="profile-modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="black-button" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div></form></section></div>, document.body);
}

function PartyDetail({
  party,
  allParties,
  entries,
  edit,
  remove,
  deleteTransactions,
  updateTransaction,
  canWriteParties,
  canWriteTransactions,
  canDeleteParties,
  canDeleteTransactions,
}: {
  party: Party;
  allParties: Party[];
  entries: Entry[];
  edit: () => void;
  remove: () => void;
  deleteTransactions: (ids: string[]) => Promise<string[]>;
  updateTransaction: (entry: Entry) => Promise<boolean>;
  canWriteParties: boolean;
  canWriteTransactions: boolean;
  canDeleteParties: boolean;
  canDeleteTransactions: boolean;
}) {
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(() => new Set());
  const [deletingTransaction, setDeletingTransaction] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<"party" | "transactions" | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState("");
  const [editingTransaction, setEditingTransaction] = useState<Entry | null>(null);
  const rows = entries.filter(
    (entry) =>
      entry.partyId === party.id,
  );
  const selectedTransactions = rows.filter((entry) => selectedTransactionIds.has(entry.id));

  const removeSelectedTransactions = async () => {
    if (selectedTransactions.length === 0) return;
    setConfirmingDelete(null);
    setDeletingTransaction(true);
    const deletedIds = await deleteTransactions(selectedTransactions.map((entry) => entry.id));
    setDeletingTransaction(false);
    setSelectedTransactionIds((current) => new Set([...current].filter((id) => !deletedIds.includes(id))));
  };

  const purchased = rows
    .filter(
      (entry) =>
        entry.type === "PURCHASE",
    )
    .reduce(
      (sum, entry) =>
        sum + toCents(entry.amount),
      0,
    ) / 100;

  const paid = rows
    .filter(
      (entry) =>
        entry.type === "PAYMENT",
    )
    .reduce(
      (sum, entry) =>
        sum + toCents(entry.amount),
      0,
    ) / 100;
  const primaryLabel = party.partyType === "supplier" ? "Purchases" : "Sales";
  const paymentLabel = party.partyType === "supplier" ? "Payments made" : "Payments received";
  const outstandingLabel = party.partyType === "supplier" ? "Outstanding to pay" : "Outstanding to collect";

  const exportHistory = async () => {
    setExportingPdf(true);
    setExportError("");
    try {
      const [{ createPartyStatementPdf }, fontResponse] = await Promise.all([
        import("./lib/partyStatementPdf"),
        fetch(statementFontUrl),
      ]);
      if (!fontResponse.ok) throw new Error("Could not load the statement font.");
      const pdf = await createPartyStatementPdf(party, rows, new Uint8Array(await fontResponse.arrayBuffer()));
      const filename = pdfFilename(`${party.name}-statement`);
      await downloadPdf(filename, new Uint8Array(pdf));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      console.error(cause);
      setExportError("Could not create the PDF statement. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="party-detail">
      <Header
        eyebrow="PARTY ACCOUNT"
        title={party.name}
        description={
          party.company ||
          "Account overview and transaction history"
        }
        action={canWriteTransactions ? () =>
          go(`add-entry/${encodeURIComponent(partySegment(party, allParties))}`)
        : undefined}
        label="New transaction"
      />

      <div className="party-header-info" aria-label="Party contact information">
        <div>
          <Phone size={17} aria-hidden="true" />
          <span><small>Contact number</small><strong>{party.contact || "Not provided"}</strong></span>
        </div>
        <div>
          <MapPin size={17} aria-hidden="true" />
          <span><small>Location</small><strong>{party.location || "Not provided"}</strong></span>
        </div>
      </div>

      <div className="party-toolbar">
        <button className="party-back-button" onClick={() => go("parties")}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to parties
        </button>
        <div className="party-actions">
          {canWriteParties && <button className="outline-button" onClick={edit}>Edit party</button>}
          {canDeleteParties && <button className="delete-button" onClick={() => setConfirmingDelete("party")}>
            <Trash2 size={14} />
            Delete party
          </button>}
        </div>
      </div>

      <section className={`summary-grid party-summary ${party.partyType}`}>
        <div>
          <span>{primaryLabel}</span>
          <strong>
            {money(purchased)}
          </strong>
        </div>

        <div>
          <span>{paymentLabel}</span>
          <strong>{money(paid)}</strong>
        </div>

        <div>
          <span>
            {outstandingLabel}
          </span>

          <strong>
            {money(
              Math.max(
                0,
                purchased - paid,
              ),
            )}
          </strong>
        </div>

        <div>
          <span>Advance payments</span>

          <strong>
            {money(
              Math.max(
                0,
                paid - purchased,
              ),
            )}
          </strong>
        </div>
      </section>

      {party.notes && (
        <section className="party-notes reference-panel">
          <span>NOTES</span>
          <p>{party.notes}</p>
        </section>
      )}

      <section className="reference-panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              ACCOUNT HISTORY
            </span>

            <h2>
              Transaction history
            </h2>
          </div>
          <button type="button" className="outline-button party-export-button" onClick={exportHistory} disabled={exportingPdf}>
            <Download size={15} />
            {exportingPdf ? "Preparing PDF..." : "Download PDF"}
          </button>
        </div>
        {exportError && <p className="party-export-error" role="alert">{exportError}</p>}

        {canDeleteTransactions && selectedTransactions.length > 0 && (
          <div className="selected-transaction-bar">
            <span>{selectedTransactions.length} transaction{selectedTransactions.length === 1 ? "" : "s"} selected</span>
            <div className="selected-transaction-actions">
              <button type="button" className="outline-button" disabled={deletingTransaction} onClick={() => setSelectedTransactionIds(selectedTransactions.length === rows.length ? new Set() : new Set(rows.map((entry) => entry.id)))}>
                {selectedTransactions.length === rows.length ? "Clear selection" : "Select all"}
              </button>
              <button type="button" className="delete-button" disabled={deletingTransaction} onClick={() => setConfirmingDelete("transactions")}>
                <Trash2 size={14} aria-hidden="true" />
                {deletingTransaction ? "Deleting..." : `Delete ${selectedTransactions.length} transaction${selectedTransactions.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        <Table
          entries={rows}
          parties={[party]}
          emptyMessage="No transactions for this party yet."
          selectedIds={selectedTransactionIds}
          selectionDisabled={deletingTransaction}
          onSelect={canDeleteTransactions ? (entry) => setSelectedTransactionIds((current) => {
            const next = new Set(current);
            if (next.has(entry.id)) next.delete(entry.id);
            else next.add(entry.id);
            return next;
          }) : undefined}
          onEdit={canWriteTransactions ? setEditingTransaction : undefined}
        />
      </section>
      {editingTransaction && <EditTransaction entry={editingTransaction} party={party} onClose={() => setEditingTransaction(null)} onSave={async (next) => { const success = await updateTransaction(next); if (success) setEditingTransaction(null); return success; }} />}
      {(canDeleteParties || canDeleteTransactions) && confirmingDelete && createPortal(
        <div className="delete-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmingDelete(null); }} onKeyDown={(event) => { if (event.key === "Escape") setConfirmingDelete(null); }}>
          <section className="delete-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-detail">
            <div className="delete-confirm-heading"><span aria-hidden="true"><Trash2 size={18} /></span><div><p className="delete-confirm-kicker">Permanent action</p><h2 id="delete-confirm-title">{confirmingDelete === "party" ? `Delete ${party.name}?` : `Delete ${selectedTransactions.length} transaction${selectedTransactions.length === 1 ? "" : "s"}?`}</h2></div></div>
            <p id="delete-confirm-detail">{confirmingDelete === "party" ? "This will permanently remove the party and all its transactions." : "Only the selected transactions will be removed. Party balances will update."} This cannot be undone.</p>
            <div className="delete-confirm-actions">
              <button type="button" className="outline-button" autoFocus onClick={() => setConfirmingDelete(null)}>Cancel</button>
              <button type="button" className="delete-button" onClick={() => { if (confirmingDelete === "party") { setConfirmingDelete(null); remove(); } else { void removeSelectedTransactions(); } }}>
                <Trash2 size={14} aria-hidden="true" /> Delete permanently
              </button>
            </div>
          </section>
        </div>
      , document.body)}
    </div>
  );
}

/* =========================================================
   LOGIN
   ========================================================= */

function Login() {
  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const submit = async (
    event: FormEvent,
  ) => {
    event.preventDefault();

    setLoading(true);
    setError("");

    const { error } =
      await supabase.auth.signInWithPassword(
        {
          email,
          password,
        },
      );

    if (error) {
      setError(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="login-page">
      <main className="login-shell">
        <form className="login-panel" onSubmit={submit}>
            <div className="login-lockup">
              <img className="login-logo brand-mark" src={ledgerMark} alt="RKH Ledger" />
              <span>RKH Ledger</span>
            </div>
            <div className="login-heading">
              <h1>Sign in</h1>
              <p>Use your RKH Suppliers account to continue.</p>
            </div>

            <div className="login-fields">
              <label>
                <span>
                  Email address
                </span>

                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>Password</span>
                <span className="login-password-field"><input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((show) => !show)}>{showPassword ? "Hide" : "Show"}</button></span>
              </label>
            </div>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <button
              className="login-button"
              disabled={loading}
              type="submit"
            >
              {loading
                ? "Signing in..."
                : "Sign in to ledger"}
            </button>

            <p className="login-security">
              Authorized access for RKH Suppliers.
            </p>
            <p className="login-footnote">RKH Suppliers · Kathmandu, Nepal</p>
        </form>
      </main>
    </div>
  );
}

function LoadingScreen({ title, detail }: { title: string; detail: string }) {
  return <main className="app-loading" aria-live="polite" aria-busy="true">
    <section className="app-loading-card">
      <img src={ledgerMark} alt="RKH Ledger" />
      <span className="app-loading-spinner" aria-hidden="true" />
      <h1>{title}</h1>
      <p>{detail}</p>
    </section>
  </main>;
}

/* =========================================================
   MAIN APP
   ========================================================= */

export default function App() {
  const [current, setCurrent] =
    useState(currentRoute());

  const [
    authenticated,
    setAuthenticated,
  ] = useState<boolean | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [roleError, setRoleError] = useState("");
  const role = profile?.userId === authUserId ? profile.role : null;
  const has = (permission: Permission) => Boolean(profile?.permissions.includes(permission));
  const restrictedRoute = Boolean(role && (
    (["parties", "transactions"].includes(current.path) && !has("ledger_view")) ||
    (["add-party", "edit-party"].includes(current.path) && !has("parties_write")) ||
    (current.path === "add-entry" && !has("transactions_write")) ||
    (current.path === "reports" && !has("reports_view")) ||
    (current.path === "sahakari" && !has("sahakari_view")) ||
    (current.path === "users" && !profile?.isOwner)
  ));

  const [parties, setParties] =
    useState<Party[]>([]);

  const [entries, setEntries] =
    useState<Entry[]>([]);

  const [
    loadingData,
    setLoadingData,
  ] = useState(false);

  const [dataError, setDataError] =
    useState("");

  const [notice, setNotice] = useState<Notice | null>(null);
  const showNotice = (title: string, detail: string, tone: Notice["tone"] = "success") => {
    setNotice({ id: Date.now(), title, detail, tone });
  };

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  /* ROUTING */

  useEffect(() => {
    const listen = () =>
      setCurrent(currentRoute());

    window.addEventListener(
      "popstate",
      listen,
    );

    return () =>
      window.removeEventListener(
        "popstate",
        listen,
      );
  }, []);

  useEffect(() => {
    if (current.path !== "parties" || !current.id || !has("ledger_view")) return;
    const party = parties.find((item) => item.id === current.id);
    if (!party) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.history.replaceState({}, "", `${base}/${partyPath(party, parties)}`);
    setCurrent(currentRoute());
  }, [current.path, current.id, parties, role]);

  /* AUTH */

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setAuthUserId(data.session?.user.id ?? null);
        setAuthenticated(
          Boolean(data.session),
        );
      });

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setAuthUserId(session?.user.id ?? null);
          setAuthenticated(
            Boolean(session),
          );
        },
      );

    return () =>
      subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authUserId) {
      setProfile(null);
      setRoleError("");
      return;
    }

    let cancelled = false;
    setRoleError("");

    const loadRole = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userError || !user || user.id !== authUserId) {
        setRoleError(userError?.message ?? "Could not verify your account.");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("role, full_name, contact, avatar_path")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (error || !data?.role) {
        setRoleError(error?.message ?? "Your account has no valid access role.");
        return;
      }

      const [roleResult, ownerResult] = await Promise.all([
        supabase.from("app_roles").select("name, permissions").eq("role_key", data.role).single(),
        supabase.rpc("is_app_owner"),
      ]);
      if (cancelled) return;
      if (roleResult.error || ownerResult.error || !roleResult.data) {
        setRoleError(roleResult.error?.message ?? ownerResult.error?.message ?? "Could not load access permissions.");
        return;
      }

      setProfile({
        userId: user.id,
        role: data.role as UserRole,
        roleName: roleResult.data.name,
        permissions: roleResult.data.permissions as Permission[],
        isOwner: ownerResult.data === true,
        email: user.email ?? "",
        fullName: data.full_name ?? "",
        contact: data.contact ?? "",
        avatarPath: data.avatar_path ?? null,
      });
    };

    void loadRole();
    return () => { cancelled = true; };
  }, [authUserId]);

  useEffect(() => {
    if (!profile?.avatarPath || profile.userId !== authUserId) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    const refreshAvatar = async () => {
      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(profile.avatarPath!, 3600);
      if (!cancelled) setAvatarUrl(error ? null : data.signedUrl);
    };
    void refreshAvatar();
    const interval = window.setInterval(() => { void refreshAvatar(); }, 50 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [authUserId, profile?.userId, profile?.avatarPath]);

  useEffect(() => {
    if (restrictedRoute) {
      go("dashboard");
    }
  }, [restrictedRoute]);

  /* LOAD DATABASE */

  const loadData = async () => {
    setLoadingData(true);
    setDataError("");
    if (!profile?.permissions.includes("ledger_view")) {
      setParties([]);
      setEntries([]);
      setLoadingData(false);
      return;
    }

    const [
      partyResult,
      transactionResult,
    ] = await Promise.all([
      supabase
        .from("parties")
        .select("*")
        .order("name"),

      supabase
        .from("transactions")
        .select("*")
        .order("date_ad", {
          ascending: false,
        })
        .order("created_at", {
          ascending: false,
        }),
    ]);

    if (
      partyResult.error ||
      transactionResult.error
    ) {
      console.error(
        "Party error:",
        partyResult.error,
      );

      console.error(
        "Transaction error:",
        transactionResult.error,
      );

      setDataError(
        partyResult.error?.message ||
          transactionResult.error
            ?.message ||
          "Could not load ledger data.",
      );

      setLoadingData(false);

      return;
    }

    const mappedParties: Party[] =
      (partyResult.data ?? []).map(
        (party) => ({
          id: party.id,
          partyType: party.party_type === "supplier" ? "supplier" : "customer",
          name: party.name,
          company:
            party.company_name ?? "",
          contact:
            party.contact ?? "",
          location:
            party.location ?? "",
          notes: party.notes ?? "",
        }),
      );

    const mappedEntries: Entry[] =
      (
        transactionResult.data ?? []
      ).map((entry) => ({
        id: entry.id,
        partyId: entry.party_id,
        type:
          entry.type as EntryType,
        amount: Number(entry.amount),
        ad: entry.date_ad,
        bs: entry.date_bs,
        description:
          entry.description ?? "",
      }));

    setParties(mappedParties);

    setEntries(mappedEntries);

    setLoadingData(false);
  };

  useEffect(() => {
    if (authenticated && profile) {
      loadData();
    } else if (
      authenticated === false
    ) {
      setParties([]);
      setEntries([]);
    }
  }, [authenticated, profile?.userId, profile?.role]);

  /* ADD PARTY */

  const addParty = async (
    party: Omit<Party, "id">,
  ): Promise<boolean> => {
    const { data, error } =
      await supabase
        .from("parties")
        .insert({
          party_type: party.partyType,
          name: party.name.trim(),

          company_name:
            party.company?.trim() ||
            null,

          contact:
            party.contact?.trim() ||
            "",

          location:
            party.location?.trim() ||
            null,

          notes:
            party.notes?.trim() ||
            null,
        })
        .select("id, party_type, name, company_name, contact, location, notes")
        .single();

    if (error) {
      console.error(error);
      showNotice("Could not save party", partySaveErrorMessage(error.message), "error");

      return false;
    }

    setParties((items) => [
      ...items,

      {
        id: data.id,
        partyType: data.party_type === "supplier" ? "supplier" : "customer",
        name: data.name,

        company:
          data.company_name ?? "",

        contact:
          data.contact ?? "",

        location:
          data.location ?? "",

        notes:
          data.notes ?? "",
      },
    ]);

    showNotice("Party added", `${data.name} is ready for transactions.`);

    return true;
  };

  /* UPDATE PARTY */

  const updateParty = async (
    party: Party,
  ): Promise<boolean> => {
    const { error } =
      await supabase
        .from("parties")
        .update({
          party_type: party.partyType,
          name: party.name.trim(),

          company_name:
            party.company?.trim() ||
            null,

          contact:
            party.contact?.trim() ||
            "",

          location:
            party.location?.trim() ||
            null,

          notes:
            party.notes?.trim() ||
            null,

          updated_at:
            new Date().toISOString(),
        })
        .eq("id", party.id);

    if (error) {
      console.error(error);
      showNotice("Could not update party", partySaveErrorMessage(error.message), "error");

      return false;
    }

    setParties((items) =>
      items.map((item) =>
        item.id === party.id
          ? party
          : item,
      ),
    );

    showNotice("Party updated", `${party.name}'s details were saved.`);

    return true;
  };

  /* DELETE PARTY */

  const deleteParty = async (
    party: Party,
  ) => {
    const { error } =
      await supabase
        .from("parties")
        .delete()
        .eq("id", party.id);

    if (error) {
      showNotice("Could not delete party", error.message, "error");

      return;
    }

    setParties((items) =>
      items.filter(
        (item) =>
          item.id !== party.id,
      ),
    );

    setEntries((items) => items.filter((entry) => entry.partyId !== party.id));
    showNotice("Party deleted", `${party.name} and its transaction history were removed.`);

    go("parties");
  };

  const deleteTransactions = async (ids: string[]): Promise<string[]> => {
    const { data, error } = await supabase
      .from("transactions")
      .delete()
      .in("id", ids)
      .select("id");

    if (error) {
      showNotice("Could not delete transactions", error.message, "error");
      return [];
    }

    const deletedIds = (data ?? []).map((item) => item.id);
    const deletedSet = new Set(deletedIds);
    if (deletedIds.length > 0) {
      setEntries((items) => items.filter((item) => !deletedSet.has(item.id)));
    }
    if (deletedIds.length === ids.length) {
      showNotice("Transactions deleted", `${deletedIds.length} transaction${deletedIds.length === 1 ? "" : "s"} removed. Balances have been updated.`);
    } else {
      showNotice("Some transactions were not deleted", `${deletedIds.length} of ${ids.length} selected transactions were removed.`, "error");
    }
    return deletedIds;
  };

  const updateTransaction = async (entry: Entry): Promise<boolean> => {
    const amountCents = toCents(entry.amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return false;
    const { data, error } = await supabase.from("transactions").update({
      party_id: entry.partyId,
      type: entry.type,
      amount: (amountCents / 100).toFixed(2),
      date_ad: entry.ad,
      date_bs: entry.bs,
      description: entry.description || null,
    }).eq("id", entry.id).select("id, party_id, type, amount, date_ad, date_bs, description").single();
    if (error || !data) { console.error(error); showNotice("Could not update transaction", error?.message ?? "Please try again.", "error"); return false; }
    const saved: Entry = { id: data.id, partyId: data.party_id, type: data.type as EntryType, amount: Number(data.amount), ad: data.date_ad, bs: data.date_bs, description: data.description ?? "" };
    setEntries((items) => items.map((item) => item.id === saved.id ? saved : item));
    showNotice("Transaction updated", `${money(saved.amount)} saved for ${partyName(parties, saved.partyId)}.`);
    return true;
  };

  /* ADD TRANSACTION */

  const addEntry = async (
    entry: Omit<Entry, "id"> & { paidNow?: number },
  ): Promise<boolean> => {
    const party = parties.find((item) => item.id === entry.partyId);
    const supplierEntry = party?.partyType === "supplier";
    const amountCents = toCents(entry.amount);
    const paidNowCents = toCents(entry.paidNow ?? 0);
    const paidNow = paidNowCents / 100;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(paidNowCents) || (entry.type === "PURCHASE" && (paidNowCents < 0 || paidNowCents > amountCents))) {
      return false;
    }

    const transactionRows: Array<{
      party_id: string;
      type: EntryType;
      amount: string;
      date_ad: string;
      date_bs: string;
      description: string | null;
    }> = [{
      party_id: entry.partyId,
      type: entry.type,
      amount: (amountCents / 100).toFixed(2),
      date_ad: entry.ad,
      date_bs: entry.bs,
      description: entry.description.trim() || null,
    }];

    if (entry.type === "PURCHASE" && paidNow > 0) {
      transactionRows.push({
        party_id: entry.partyId,
        type: "PAYMENT",
        amount: paidNow.toFixed(2),
        date_ad: entry.ad,
        date_bs: entry.bs,
        description: supplierEntry ? "Payment made with purchase" : "Payment received with sale",
      });
    }

    const { data, error } =
      await supabase
        .from("transactions")
        .insert(transactionRows)
        .select("id, party_id, type, amount, date_ad, date_bs, description");

    if (error || !data) {
      console.error(error);

      return false;
    }

    const saved: Entry[] = data.map((row) => ({
      id: row.id,
      partyId: row.party_id,
      type: row.type as EntryType,
      amount: Number(row.amount),
      ad: row.date_ad,
      bs: row.date_bs,
      description: row.description ?? "",
    }));

    setEntries((items) => [
      ...saved,
      ...items,
    ]);

    const expectedAmounts = transactionRows.map((row) => `${row.type}:${row.amount}`).sort().join("|");
    const savedAmounts = saved.map((row) => `${row.type}:${row.amount.toFixed(2)}`).sort().join("|");
    if (expectedAmounts !== savedAmounts) {
      showNotice("Saved amount differs", "The database returned a different amount. Please review this transaction.", "error");
      return true;
    }

    const name = partyName(parties, entry.partyId);
    const primaryLabel = supplierEntry ? "Purchase" : "Sale";
    const paymentLabel = supplierEntry ? "Payment made" : "Payment received";
    if (entry.type === "PURCHASE" && paidNow > 0) {
      showNotice(`${primaryLabel} and payment recorded`, `${money(paidNow)} paid now · ${money(entry.amount - paidNow)} remaining for ${name}`);
    } else {
      showNotice(
        entry.type === "PAYMENT" ? paymentLabel : `${primaryLabel} recorded`,
        `${money(entry.amount)} · ${name}`,
      );
    }

    return true;
  };

  /* LOGOUT */

  const logout = async () => {
    await supabase.auth.signOut();

    go("dashboard");
  };

  const saveProfile = async (fullName: string, contact: string, photo: File | null): Promise<string | null> => {
    if (!profile || profile.userId !== authUserId) return "Your session has changed. Please sign in again.";
    let avatarPath = profile.avatarPath;
    if (photo) {
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[photo.type];
      if (!extension || photo.size > 5 * 1024 * 1024) return "Choose a JPG, PNG, or WEBP image under 5 MB.";
      avatarPath = `${profile.userId}/avatar-${Date.now()}.${extension}`;
      const { error } = await supabase.storage.from("avatars").upload(avatarPath, photo, { contentType: photo.type });
      if (error) return error.message;
    }
    const { error } = await supabase.from("profiles").update({
      full_name: fullName,
      contact,
      avatar_path: avatarPath,
      updated_at: new Date().toISOString(),
    }).eq("id", profile.userId);
    if (error) return error.message;
    if (photo && avatarPath) {
      const { data } = await supabase.storage.from("avatars").createSignedUrl(avatarPath, 3600);
      setAvatarUrl(data?.signedUrl ?? null);
    }
    setProfile({ ...profile, fullName, contact, avatarPath });
    return null;
  };

  /* AUTH LOADING */

  if (authenticated === null) {
    return <LoadingScreen title="Opening RKH Ledger" detail="Checking your secure session" />;
  }

  /* LOGIN */

  if (!authenticated) {
    return <Login />;
  }

  if (roleError) {
    return (
      <div className="login-page"><div className="login-panel">
        <h1>Could not verify access</h1>
        <p>{roleError}</p>
        <button className="outline-button" onClick={logout}>Sign out</button>
      </div></div>
    );
  }

  if (!role || !profile) {
    return <LoadingScreen title="Checking access" detail="Preparing your workspace" />;
  }

  /* DATABASE LOADING */

  if (loadingData) {
    return <LoadingScreen title="Loading your ledger" detail="Bringing your latest records together" />;
  }

  /* DATABASE ERROR */

  if (dataError) {
    return (
      <div className="login-page">
        <div className="login-panel">
          <h1>
            Could not load ledger
          </h1>

          <p>{dataError}</p>

          <button
            className="black-button"
            onClick={loadData}
          >
            Try again
          </button>

          <button
            className="outline-button"
            onClick={logout}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  /* ROUTES */

  let page: ReactNode = !has("ledger_view") && has("staff_balances_view") ? <StaffOverview /> : (
    <Dashboard parties={parties} entries={entries} canWriteTransactions={has("transactions_write")} canViewParties={has("ledger_view")} />
  );

  if (restrictedRoute) {
    // Keep restricted pages out of the render tree while the URL redirects.
  } else if (
    current.path === "parties" &&
    current.id
  ) {
    const party = findPartyByRoute(parties, current.id);

    if (party) {
      page = (
        <PartyDetail
          party={party}
          allParties={parties}
          entries={entries}
          edit={() =>
            go(
              `edit-party/${party.id}`,
            )
          }
          remove={() =>
            deleteParty(party)
          }
          deleteTransactions={deleteTransactions}
          updateTransaction={updateTransaction}
          canWriteParties={has("parties_write")}
          canWriteTransactions={has("transactions_write")}
          canDeleteParties={has("parties_delete")}
          canDeleteTransactions={has("transactions_delete")}
        />
      );
    }
  } else if (
    current.path === "edit-party" &&
    current.id
  ) {
    const party = parties.find(
      (item) =>
        item.id === current.id,
    );

    if (party) {
      page = (
        <EditParty
          party={party}
          parties={parties}
          save={updateParty}
        />
      );
    }
  } else if (
    current.path === "parties"
  ) {
    page = (
      <Parties
        parties={parties}
        entries={entries}
      />
    );
  } else if (
    current.path === "add-party"
  ) {
    page = (
      <AddParty save={addParty} />
    );
  } else if (
    current.path === "add-entry"
  ) {
    page = (
      <AddEntry
        parties={parties}
        initialPartyId={findPartyByRoute(parties, current.id ?? new URLSearchParams(window.location.search).get("party") ?? "")?.id ?? ""}
        save={addEntry}
      />
    );
  } else if (
    current.path ===
    "transactions"
  ) {
    page = (
      <Transactions
        parties={parties}
        entries={entries}
        canWriteTransactions={has("transactions_write")}
      />
    );
  } else if (current.path === "reports") {
    page = <Reports parties={parties} entries={entries} />;
  } else if (current.path === "sahakari") {
    page = <SahakariPage />;
  } else if (current.path === "users" && profile.isOwner) {
    page = <UserManagement currentUserId={profile.userId} />;
  }

  const lifetimeBalances = balancesByParty(entries);
  const snapshot = {
    outstanding: parties.reduce((total, party) => total + (party.partyType === "customer" ? Math.max(0, lifetimeBalances.get(party.id) ?? 0) : 0), 0) / 100,
    payable: parties.reduce((total, party) => total + (party.partyType === "supplier" ? Math.max(0, lifetimeBalances.get(party.id) ?? 0) : 0), 0) / 100,
    partyCount: parties.length,
    todayBs: todayDates().bs,
  };

  const shell = <Shell active={restrictedRoute ? "dashboard" : current.path} contentKey={`${current.path}:${current.id ?? ""}:${window.location.search}`} onLogout={logout} role={role} profile={profile} avatarUrl={avatarUrl} onSaveProfile={saveProfile} snapshot={snapshot}>
    {page}
  </Shell>;

  return (
    <>
    {has("sahakari_view") ? <SahakariProvider key={profile.userId} userId={profile.userId} canRecord={has("sahakari_record")} allowEdit={profile.permissions.includes("sahakari_edit")} isOwner={profile.isOwner} selectedId={current.path === "sahakari" ? current.id : undefined}>
      {shell}
    </SahakariProvider> : shell}
    <ActionNotice notice={notice} dismiss={() => setNotice(null)} />
    </>
  );
}

function PartySuggestions({ id, parties, active, onSelect, emptyMessage }: {
  id: string;
  parties: Party[];
  active: number;
  onSelect: (party: Party) => void;
  emptyMessage: string;
}) {
  return <div id={id} className="party-suggestions" role="listbox" aria-label="Matching parties">
    {parties.length ? parties.map((party, index) => <button
      type="button"
      id={`${id}-${index}`}
      role="option"
      aria-selected={index === active}
      className={index === active ? "active" : ""}
      key={party.id}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(party)}
    >
      <UsersRound size={16} aria-hidden="true" />
      <span><strong>{party.name}</strong><small>{[party.company, party.contact].filter(Boolean).join(" · ") || "Party account"}</small></span>
      <ArrowRight size={14} aria-hidden="true" />
    </button>) : <p>{emptyMessage}</p>}
  </div>;
}

function ActionNotice({ notice, dismiss }: { notice: Notice | null; dismiss: () => void }) {
  return (
    <div className="notice-region" aria-live="polite" aria-atomic="true">
      {notice && (
        <div className={`action-notice ${notice.tone}`} key={notice.id} role={notice.tone === "error" ? "alert" : "status"}>
          <span className="notice-icon" aria-hidden="true">
            {notice.tone === "error" ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
          </span>
          <span className="notice-copy">
            <strong>{notice.title}</strong>
            <small>{notice.detail}</small>
          </span>
          <button type="button" aria-label="Dismiss notification" onClick={dismiss}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
