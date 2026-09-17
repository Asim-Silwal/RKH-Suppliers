import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  adToBs, kathmanduNow, loadSahakari, shouldShowSahakariReminder,
  type Cooperative, type CooperativeEntry,
} from "../lib/sahakari";
import "./Sahakari.css";

type SahakariState = {
  cooperative: Cooperative | null;
  entries: CooperativeEntry[];
  loading: boolean;
  error: string;
  time: ReturnType<typeof kathmanduNow>;
  userId: string;
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

export function SahakariProvider({ userId, allowEdit, children }: { userId: string; allowEdit: boolean; children: ReactNode }) {
  const [cooperative, setCooperative] = useState<Cooperative | null>(null);
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
      setCooperative(data.cooperative);
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

  const todayEntry = entries.find((entry) => entry.entryDate === time.date) ?? null;
  const autoOpen = Boolean(cooperative && !loading && !error &&
    shouldShowSahakariReminder(time, Boolean(todayEntry), dismissedDate));
  const close = () => { setManualOpen(false); setDismissedDate(time.date); };

  return <SahakariContext.Provider value={{
    cooperative, entries, loading, error, time, userId, allowEdit, message, refresh,
    openRecord: () => { if (todayEntry && !allowEdit) return; setMessage(""); setManualOpen(true); },
  }}>
    {children}
    {cooperative && !error && (!todayEntry || allowEdit) && (autoOpen || manualOpen) && <SahakariReminderModal
      key={`${time.date}:${todayEntry?.id ?? "new"}`}
      cooperative={cooperative}
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
      <div className="sahakari-modal-heading"><div><span className="eyebrow">DAILY SAVING · {adToBs(today)} BS</span><h2 id="sahakari-reminder-title">Subha Bitta Daily Saving</h2></div><button type="button" aria-label="Close reminder" onClick={onClose} disabled={saving}><X size={18} /></button></div>
      <p>Aaja Subha Bitta ma deposit garnu bhayo?</p>
      <div className="sahakari-choice" role="group" aria-label="Deposit status">
        <button type="button" className={choice === "yes" ? "selected" : ""} aria-pressed={choice === "yes"} onClick={() => { setChoice("yes"); setError(""); }}>YES</button>
        <button type="button" className={choice === "no" ? "selected" : ""} aria-pressed={choice === "no"} onClick={() => { setChoice("no"); setError(""); }}>NO</button>
      </div>
      {choice && <form onSubmit={submit}>
        {choice === "yes" ? <label>Amount (NPR)<input required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          : <label>Why was today's deposit not made?<textarea required rows={4} placeholder="Bank closed, cash shortage, holiday, shop closed, etc." value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        {error && <p className="sahakari-error" role="alert">{error}</p>}
        <div className="sahakari-modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>Close</button><button type="submit" className="black-button" disabled={saving}>{saving ? "Saving..." : choice === "yes" ? "Save deposit" : "Save reason"}</button></div>
      </form>}
    </section>
  </div>, document.body);
}

const money = (value: number) => `NPR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SahakariPage() {
  const { cooperative, entries, loading, error, time, allowEdit, message, refresh, openRecord } = useSahakari();
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

  return <div className="sahakari-page">
    <header className="reference-header"><div><span className="eyebrow">COOPERATIVE SAVINGS · {adToBs(time.date)} BS</span><h1>Sahakari</h1><p>{cooperative?.name ?? "Subha Bitta Multipurpose Co-operative Ltd."}</p></div>
      {cooperative && !loading && !error && (!todayEntry || allowEdit) && <button type="button" className="black-button" onClick={openRecord}>{todayEntry ? "Edit today" : "Record today"}</button>}</header>
    {message && <p className="sahakari-message" role="status">{message}</p>}
    {error && <section className="reference-panel sahakari-state" role="alert"><p>{error}</p><button type="button" className="outline-button" onClick={() => void refresh()}>Try again</button></section>}
    {loading && !error && <section className="reference-panel sahakari-state">Loading Sahakari records...</section>}
    {!loading && !error && cooperative && <>
      <div className="sahakari-summary">
        <div><span>Today's status</span><strong>{todayEntry ? todayEntry.deposited ? "Deposited" : "Not deposited" : time.isSaturday ? "No deposit scheduled" : "Pending"}</strong></div>
        <div><span>Today's amount</span><strong>{todayEntry?.deposited && todayEntry.amount !== null ? money(todayEntry.amount) : "—"}</strong></div>
        <div><span>This month deposited</span><strong>{money(depositedEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0))}</strong></div>
        <div><span>Total saved</span><strong>{money(entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0))}</strong></div>
        <div><span>This month deposit days</span><strong>{depositedEntries.length} days</strong></div>
        <div><span>This month missed days</span><strong>{missedDays} days</strong></div>
      </div>
      <section className="reference-panel sahakari-history"><div className="panel-heading"><div><span className="eyebrow">SAVINGS HISTORY</span><h2>Daily records</h2></div><label>Month (BS)<select value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}><option value="all">All dates</option>{historyMonths.map((month) => <option key={month} value={month}>{month} BS</option>)}</select></label></div>
        <div className="sahakari-table-scroll"><table><thead><tr><th>Date (BS)</th><th>Status</th><th>Amount</th><th>Balance</th><th>Reason</th><th>Recorded by</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td>{adToBs(entry.entryDate)} BS</td><td>{entry.deposited ? "Deposited" : "Not deposited"}</td><td>{entry.deposited && entry.amount !== null ? money(entry.amount) : "—"}</td><td>{money(balanceByEntry.get(entry.id) ?? 0)}</td><td>{entry.reason || "—"}</td><td>{entry.recordedByName ?? (entry.recordedBy ? "Unnamed user" : "—")}</td></tr>)}</tbody></table>{history.length === 0 && <p className="sahakari-empty">No records for this selection.</p>}</div>
      </section>
    </>}
  </div>;
}
