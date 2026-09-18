import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Landmark, Plus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import statementFontUrl from "../assets/NotoSansDevanagariUI-Regular.ttf?url";
import {
  adToBs, kathmanduNow, loadSahakari, shouldShowSahakariReminder,
  type Cooperative, type CooperativeEntry,
} from "../lib/sahakari";
import "./Sahakari.css";

type SahakariState = {
  cooperatives: Cooperative[];
  selectedId?: string;
  isOwner: boolean;
  entries: CooperativeEntry[];
  loading: boolean;
  error: string;
  time: ReturnType<typeof kathmanduNow>;
  userId: string;
  canRecord: boolean;
  allowEdit: boolean;
  message: string;
  refresh: () => Promise<boolean>;
  openRecord: () => void;
};

const SahakariContext = createContext<SahakariState | null>(null);

function useSahakari() {
  const state = useContext(SahakariContext);
  if (!state) throw new Error("Sahakari is outside its provider.");
  return state;
}

export function SahakariProvider({ userId, canRecord, allowEdit, isOwner, selectedId, children }: { userId: string; canRecord: boolean; allowEdit: boolean; isOwner: boolean; selectedId?: string; children: ReactNode }) {
  const [cooperatives, setCooperatives] = useState<Cooperative[]>([]);
  const [entries, setEntries] = useState<CooperativeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [time, setTime] = useState(kathmanduNow);
  const previousTime = useRef(time);
  const [dismissedDate, setDismissedDate] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await loadSahakari();
      setCooperatives(data.cooperatives);
      setEntries(data.entries);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Sahakari data.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, userId]);
  useEffect(() => {
    const updateTime = () => {
      const next = kathmanduNow();
      if (next.date !== previousTime.current.date || (previousTime.current.hour < 13 && next.hour >= 13)) void refresh();
      previousTime.current = next;
      setTime(next);
    };
    const onFocus = () => { void refresh(); updateTime(); };
    const interval = window.setInterval(updateTime, 60_000);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const primaryCooperative = cooperatives.find((item) => item.name === "Subha Bitta Multipurpose Co-operative Ltd.") ?? cooperatives[0];
  const selectedCooperative = cooperatives.find((item) => item.id === selectedId);
  const autoEntry = entries.find((entry) => entry.cooperativeId === primaryCooperative?.id && entry.entryDate === time.date) ?? null;
  const modalCooperative = manualOpen ? selectedCooperative : primaryCooperative;
  const todayEntry = entries.find((entry) => entry.cooperativeId === modalCooperative?.id && entry.entryDate === time.date) ?? null;
  const autoOpen = Boolean(canRecord && primaryCooperative && !loading && !error &&
    shouldShowSahakariReminder(time, Boolean(autoEntry), dismissedDate));
  const close = () => { setManualOpen(false); setDismissedDate(time.date); };

  return <SahakariContext.Provider value={{
    cooperatives, selectedId, isOwner, entries, loading, error, time, userId, canRecord, allowEdit, message, refresh,
    openRecord: () => { if (!canRecord || !selectedCooperative || (entries.some((entry) => entry.cooperativeId === selectedCooperative.id && entry.entryDate === time.date) && !allowEdit)) return; setMessage(""); setManualOpen(true); },
  }}>
    {children}
    {modalCooperative && !error && canRecord && (!todayEntry || allowEdit) && (autoOpen || manualOpen) && <SahakariReminderModal
      key={`${modalCooperative.id}:${time.date}:${todayEntry?.id ?? "new"}`}
      cooperative={modalCooperative}
      entry={todayEntry}
      today={time.date}
      userId={userId}
      onClose={close}
      onSaved={async (notice) => {
        setMessage(notice);
        setDismissedDate(time.date);
        setManualOpen(false);
        await refresh();
      }}
    />}
  </SahakariContext.Provider>;
}

function SahakariReminderModal({ cooperative, entry, today, userId, onClose, onSaved }: {
  cooperative: Cooperative;
  entry: CooperativeEntry | null;
  today: string;
  userId: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<"yes" | "no" | null>(entry ? entry.deposited ? "yes" : "no" : null);
  const [amount, setAmount] = useState(String(entry?.amount ?? cooperative.defaultDailyAmount));
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    const numericAmount = Number(amount);
    if (choice === "yes" && (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || !Number.isFinite(numericAmount) || numericAmount <= 0)) {
      setError("Enter an amount greater than zero, with at most two decimal places.");
      return;
    }
    if (choice === "no" && !reason.trim()) {
      setError("Please explain why today's deposit was not made.");
      return;
    }

    setSaving(true);
    setError("");
    const values = {
      deposited: choice === "yes",
      amount: choice === "yes" ? numericAmount : null,
      reason: choice === "no" ? reason.trim() : null,
    };
    const result = entry
      ? await supabase.from("cooperative_entries").update({ ...values, updated_at: new Date().toISOString() }).eq("id", entry.id).select("id").single()
      : await supabase.from("cooperative_entries").insert({
        cooperative_id: cooperative.id, entry_date: today, recorded_by: userId, ...values,
      }).select("id").single();
    if (result.error) {
      if (result.error.code === "23505") {
        await onSaved("Today's Sahakari record has already been saved by someone else.");
      } else {
        setError(result.error.message);
      }
      setSaving(false);
      return;
    }
    await onSaved(entry ? "Sahakari record updated." : "Today's Sahakari record saved.");
    setSaving(false);
  };

  return createPortal(<div className="sahakari-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="sahakari-modal" role="dialog" aria-modal="true" aria-labelledby="sahakari-reminder-title">
      <div className="sahakari-modal-heading"><div><span className="eyebrow">DAILY SAVING · {adToBs(today)} BS</span><h2 id="sahakari-reminder-title">{cooperative.name}</h2></div><button type="button" aria-label="Close reminder" onClick={onClose} disabled={saving}><X size={18} /></button></div>
      <p className="sahakari-modal-intro">Choose what happened today. Each date can be recorded once.</p>
      <div className="sahakari-choice" role="group" aria-label="Deposit status">
        <button type="button" className={choice === "yes" ? "selected" : ""} aria-pressed={choice === "yes"} onClick={() => { setChoice("yes"); setError(""); }}><strong>Deposited</strong><small>Enter the amount saved</small></button>
        <button type="button" className={choice === "no" ? "selected" : ""} aria-pressed={choice === "no"} onClick={() => { setChoice("no"); setError(""); }}><strong>Not deposited</strong><small>Add a short reason</small></button>
      </div>
      {choice && <form onSubmit={submit}>
        {choice === "yes" ? <label>Amount saved <span className="sahakari-money-input"><span>NPR</span><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
          : <label>Why was today's deposit not made?<textarea required rows={4} placeholder="Bank closed, cash shortage, holiday, shop closed, etc." value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        {error && <p className="sahakari-error" role="alert">{error}</p>}
        <div className="sahakari-modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>Close</button><button type="submit" className="black-button" disabled={saving}>{saving ? "Saving..." : choice === "yes" ? "Save deposit" : "Save reason"}</button></div>
      </form>}
    </section>
  </div>, document.body);
}

const money = (value: number) => `NPR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function openSahakari(id?: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  window.history.pushState({}, "", `${base}/sahakari${id ? `/${encodeURIComponent(id)}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function SahakariPage() {
  const { cooperatives, selectedId, isOwner, entries: allEntries, loading, error, time, canRecord, allowEdit, message, refresh, openRecord } = useSahakari();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("5000");
  const [savingCooperative, setSavingCooperative] = useState(false);
  const [createError, setCreateError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const cooperative = cooperatives.find((item) => item.id === selectedId);
  const entries = allEntries.filter((entry) => entry.cooperativeId === selectedId);
  const currentBsMonth = adToBs(time.date).slice(0, 7);
  const [historyMonth, setHistoryMonth] = useState("all");
  const todayEntry = entries.find((entry) => entry.entryDate === time.date);
  const currentMonthEntries = entries.filter((entry) => adToBs(entry.entryDate).startsWith(currentBsMonth));
  const depositedEntries = currentMonthEntries.filter((entry) => entry.deposited);
  const missedDays = currentMonthEntries.filter((entry) => !entry.deposited).length;
  const history = historyMonth === "all" ? entries : entries.filter((entry) => adToBs(entry.entryDate).startsWith(historyMonth));
  const historyMonths = [...new Set([currentBsMonth, ...entries.map((entry) => adToBs(entry.entryDate).slice(0, 7))])].sort().reverse();
  let runningBalance = 0;
  const balanceByEntry = new Map(entries.slice().reverse().map((entry) => {
    runningBalance += entry.amount ?? 0;
    return [entry.id, runningBalance];
  }));

  const downloadRecords = async () => {
    if (!cooperative) return;
    setExporting(true);
    setExportError("");
    try {
      const [{ createSahakariPdf }, fontResponse] = await Promise.all([import("../lib/sahakariPdf"), fetch(statementFontUrl)]);
      if (!fontResponse.ok) throw new Error("Could not load the PDF font.");
      const pdf = await createSahakariPdf({
        cooperativeName: cooperative.name,
        period: historyMonth === "all" ? "All recorded dates" : `${historyMonth} BS`,
        generatedBs: adToBs(time.date),
        rows: history.map((entry) => ({
          dateBs: adToBs(entry.entryDate),
          status: entry.deposited ? "Deposited" : "Not deposited",
          amount: entry.deposited ? entry.amount : null,
          balance: balanceByEntry.get(entry.id) ?? 0,
          reason: entry.reason ?? "",
          recordedBy: entry.recordedByName ?? (entry.recordedBy ? "Unnamed user" : ""),
        })),
      }, new Uint8Array(await fontResponse.arrayBuffer()));
      const name = cooperative.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sahakari";
      const filename = `${name}-daily-records-${historyMonth === "all" ? "all-dates" : historyMonth}-bs.pdf`;
      const safeBytes = Uint8Array.from(pdf);
      const url = URL.createObjectURL(new File([safeBytes.buffer], filename, { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Could not create the PDF.");
    } finally {
      setExporting(false);
    }
  };

  const addCooperative = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(newAmount);
    if (!newName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCreateError("Enter a name and a daily amount greater than zero.");
      return;
    }
    setSavingCooperative(true);
    setCreateError("");
    const { data, error: insertError } = await supabase.from("cooperatives")
      .insert({ name: newName.trim(), default_daily_amount: amount })
      .select("id").single();
    if (insertError) setCreateError(insertError.message);
    else {
      await refresh();
      setAdding(false);
      setNewName("");
      setNewAmount("5000");
      openSahakari(data.id);
    }
    setSavingCooperative(false);
  };

  return <div className="sahakari-page">
    {selectedId && <button type="button" className="sahakari-back" onClick={() => openSahakari()}><ArrowLeft size={16} /> All Sahakari</button>}
    <header className="reference-header"><div><span className="eyebrow">COOPERATIVE SAVINGS · {adToBs(time.date)} BS</span><h1>{cooperative?.name ?? "Sahakari"}</h1><p>{cooperative ? "Daily savings and deposit history" : "Select a cooperative to view its savings and daily records."}</p></div>
      {cooperative && !loading && !error && canRecord && (!todayEntry || allowEdit) && <button type="button" className="black-button" onClick={openRecord}>{todayEntry ? "Edit today" : "Record today"}</button>}
      {!selectedId && isOwner && !loading && !error && <button type="button" className="black-button" onClick={() => { setCreateError(""); setAdding(true); }}><Plus size={16} /> Add Sahakari</button>}</header>
    {message && <p className="sahakari-message" role="status">{message}</p>}
    {error && <section className="reference-panel sahakari-state" role="alert"><p>{error}</p><button type="button" className="outline-button" onClick={() => void refresh()}>Try again</button></section>}
    {loading && !error && <section className="reference-panel sahakari-state">Loading Sahakari records...</section>}
    {!loading && !error && !selectedId && <div className="sahakari-directory">{cooperatives.map((item) => {
      const itemEntries = allEntries.filter((entry) => entry.cooperativeId === item.id);
      const itemToday = itemEntries.find((entry) => entry.entryDate === time.date);
      return <button type="button" className="sahakari-directory-card" key={item.id} onClick={() => openSahakari(item.id)}>
        <span className="sahakari-directory-icon"><Landmark size={23} /></span>
        <span className="sahakari-directory-name">{item.name}</span>
        <span className="sahakari-directory-meta">Today's status: {itemToday ? itemToday.deposited ? "Deposited" : "Not deposited" : "Pending"}</span>
        <span className="sahakari-directory-total">Total saved <strong>{money(itemEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0))}</strong></span>
        <span className="sahakari-directory-link">View details →</span>
      </button>;
    })}{cooperatives.length === 0 && <section className="reference-panel sahakari-state">No Sahakari has been added yet.</section>}</div>}
    {!loading && !error && selectedId && !cooperative && <section className="reference-panel sahakari-state">This Sahakari was not found. <button type="button" className="outline-button" onClick={() => openSahakari()}>View all Sahakari</button></section>}
    {!loading && !error && cooperative && <>
      <div className="sahakari-summary">
        <div><span>Today's status</span><strong>{todayEntry ? todayEntry.deposited ? "Deposited" : "Not deposited" : time.isSaturday ? "No deposit scheduled" : "Pending"}</strong></div>
        <div><span>Today's amount</span><strong>{todayEntry?.deposited && todayEntry.amount !== null ? money(todayEntry.amount) : "—"}</strong></div>
        <div><span>This month deposited</span><strong>{money(depositedEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0))}</strong></div>
        <div><span>Total saved</span><strong>{money(entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0))}</strong></div>
        <div><span>This month deposit days</span><strong>{depositedEntries.length} days</strong></div>
        <div><span>This month missed days</span><strong>{missedDays} days</strong></div>
      </div>
      <section className="reference-panel sahakari-history"><div className="panel-heading"><div><span className="eyebrow">SAVINGS HISTORY</span><h2>Daily records</h2></div><div className="sahakari-history-actions"><label>Month (BS)<select value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}><option value="all">All dates</option>{historyMonths.map((month) => <option key={month} value={month}>{month} BS</option>)}</select></label><button type="button" className="outline-button sahakari-download" onClick={() => void downloadRecords()} disabled={history.length === 0 || exporting}><Download size={16} /> {exporting ? "Preparing PDF..." : "Download PDF"}</button></div></div>
        {exportError && <p className="sahakari-error sahakari-export-error" role="alert">{exportError}</p>}
        <div className="sahakari-table-scroll"><table><thead><tr><th>Date (BS)</th><th>Status</th><th>Amount</th><th>Balance</th><th>Reason</th><th>Recorded by</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td>{adToBs(entry.entryDate)} BS</td><td>{entry.deposited ? "Deposited" : "Not deposited"}</td><td>{entry.deposited && entry.amount !== null ? money(entry.amount) : "—"}</td><td>{money(balanceByEntry.get(entry.id) ?? 0)}</td><td>{entry.reason || "—"}</td><td>{entry.recordedByName ?? (entry.recordedBy ? "Unnamed user" : "—")}</td></tr>)}</tbody></table>{history.length === 0 && <p className="sahakari-empty">No records for this selection.</p>}</div>
      </section>
    </>}
    {adding && createPortal(<div className="sahakari-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCooperative) setAdding(false); }}><section className="sahakari-modal" role="dialog" aria-modal="true" aria-label="Add Sahakari"><div className="sahakari-modal-heading"><div><span className="eyebrow">COOPERATIVE SAVINGS</span><h2>Add Sahakari</h2></div><button type="button" aria-label="Close" disabled={savingCooperative} onClick={() => setAdding(false)}><X size={18} /></button></div><p className="sahakari-modal-intro">Give this cooperative a clear name and set the amount suggested for daily deposits.</p><form onSubmit={(event) => void addCooperative(event)}><label>Cooperative name<input required maxLength={160} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Subha Bitta Multipurpose Co-operative Ltd." /></label><label>Suggested daily deposit <span className="sahakari-money-input"><span>NPR</span><input required type="number" min="0.01" step="0.01" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} /></span><small>You can enter a different amount for each daily record.</small></label>{createError && <p className="sahakari-error" role="alert">{createError}</p>}<div className="sahakari-modal-actions"><button type="button" className="outline-button" onClick={() => setAdding(false)} disabled={savingCooperative}>Cancel</button><button type="submit" className="black-button" disabled={savingCooperative}>{savingCooperative ? "Adding..." : "Add Sahakari"}</button></div></form></section></div>, document.body)}
  </div>;
}
