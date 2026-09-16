import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Check,
  Download,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

import { supabase } from "./lib/supabase";
import { NepaliDatePicker, todayDates } from "./components/NepaliDatePicker";
import NepaliDate from "nepali-date-converter";

type EntryType = "PURCHASE" | "PAYMENT";
type DashboardPeriod = "week" | "month" | "year" | "custom" | "lifetime";

type Party = {
  id: string;
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

const money = (value: number) =>
  `NPR ${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const partyName = (parties: Party[], id: string) =>
  parties.find((party) => party.id === id)?.name ?? "Unknown party";

const balanceOf = (entries: Entry[], partyId: string) =>
  entries
    .filter((entry) => entry.partyId === partyId)
    .reduce(
      (sum, entry) =>
        sum + (entry.type === "PURCHASE" ? entry.amount : -entry.amount),
      0,
    );

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
    id: parts[1],
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
  onLogout,
}: {
  active: string;
  children: ReactNode;
  onLogout: () => void;
}) {
  const links = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["parties", "Parties", UsersRound],
    ["add-entry", "New transaction", Plus],
    ["transactions", "Transactions", FileText],
  ] as const;

  return (
    <div className="reference-app">
      <aside className="reference-sidebar">
        <button
          className="reference-brand"
          onClick={() => go("dashboard")}
        >
          <span>RKH</span>

          <strong>RKH Suppliers</strong>

          <small>
            PRIVATE LEDGER ·
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

        <footer>
          <span>RKH SUPPLIERS · KATHMANDU</span>

          <small>Private business records</small>

          <button className="outline-button" onClick={onLogout}>
            <LogOut size={14} />
            Sign out
          </button>
        </footer>
      </aside>

      <main className="reference-main">{children}</main>
    </div>
  );
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
}: {
  entries: Entry[];
  parties: Party[];
  emptyMessage?: string;
}) {
  return (
    <div className="ledger-table">
      <div className="ledger-row ledger-head">
        <span>DATE (AD / BS)</span>
        <span>PARTY</span>
        <span>TYPE</span>
        <span>DESCRIPTION</span>
        <span>AMOUNT</span>
      </div>

      {entries.map((entry) => (
        <div className="ledger-row" key={entry.id}>
          <span>
            <b>{entry.ad}</b>
            <small>{entry.bs} BS</small>
          </span>

          <span>
            <b>{partyName(parties, entry.partyId)}</b>

            <small>
              {parties.find((party) => party.id === entry.partyId)?.company}
            </small>
          </span>

          <span className={`type ${entry.type.toLowerCase()}`}>
            {entry.type === "PURCHASE" ? "Purchase" : "Payment"}
          </span>

          <span>{entry.description || "—"}</span>

          <strong>{money(entry.amount)}</strong>
        </div>
      ))}
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
}: {
  parties: Party[];
  entries: Entry[];
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
  const entriesAsOfEnd = period === "lifetime" ? entries : invalidRange ? [] : entries.filter(
    (entry) => entry.bs <= range.to,
  );
  const purchased = periodEntries
    .filter((entry) => entry.type === "PURCHASE")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const collected = periodEntries
    .filter((entry) => entry.type === "PAYMENT")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const dueParties = parties
    .map((party) => ({ party, balance: balanceOf(entriesAsOfEnd, party.id) }))
    .filter(({ balance }) => balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const outstanding = dueParties.reduce((total, item) => total + item.balance, 0);
  const periodName = period === "custom" ? "Custom range" : period === "lifetime" ? "Lifetime" : `This ${period}`;

  return (
    <>
      <Header
        eyebrow="BUSINESS OVERVIEW"
        title="Dashboard"
        description="Track purchases, payments, and outstanding party balances in one place."
        action={() => go("add-entry")}
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

      <section className="summary-grid">
        <div>
          <span>Outstanding to collect</span>

          <strong>
            {money(outstanding)}
          </strong>

          <small>{period === "lifetime" ? "Current balance across all records" : `As of ${range.to} BS`}</small>
        </div>

        <div>
          <span>Payments recorded</span>

          <strong>{money(collected)}</strong>

          <small>{period === "lifetime" ? "Across all records" : "In the selected period"}</small>
        </div>

        <div>
          <span>Purchases recorded</span>

          <strong>{money(purchased)}</strong>

          <small>{period === "lifetime" ? "Across all records" : "In the selected period"}</small>
        </div>

        <div>
          <span>Total parties</span>

          <strong>{parties.length}</strong>

          <small>In your directory</small>
        </div>

      </section>

      <section className="activity-card" aria-label="Ledger activity summary">
        <div className="activity-copy">
          <span className="eyebrow">AT A GLANCE</span>
          <h2>Business activity</h2>
          <p>{period === "lifetime" ? "Purchases and payments across your full ledger." : "Purchases and payments in the selected period."}</p>
          <div className="activity-legend">
            <span><i className="legend-purchase" /> Purchases <strong>{money(purchased)}</strong></span>
            <span><i className="legend-payment" /> Payments <strong>{money(collected)}</strong></span>
          </div>
        </div>
        <div className="activity-chart" style={{ background: purchased + collected ? `conic-gradient(#d9a63d 0 ${(purchased / (purchased + collected)) * 100}%, #08704a 0 100%)` : "#e7eee5" }}>
          <div><strong>{periodEntries.length}</strong><small>transactions</small></div>
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="reference-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {period === "lifetime" ? "LATEST MOVEMENT" : "IN THIS PERIOD"}
              </span>

              <h2>Recent transactions</h2>
            </div>

            <button
              className="text-link"
              onClick={() => go("transactions")}
            >
              All transactions
              <ArrowRight size={14} />
            </button>
          </div>

          <Table
            entries={periodEntries.slice(0, 10)}
            parties={parties}
            emptyMessage={period === "lifetime" ? "No transactions recorded yet." : "No transactions in this date range."}
          />
        </section>

        <section className="reference-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {period === "lifetime" ? "CURRENT BALANCES" : "AS OF PERIOD END"}
              </span>

              <h2>Outstanding balances</h2>
            </div>

            <button
              className="text-link"
              onClick={() => go("parties")}
            >
              View parties
              <ArrowRight size={14} />
            </button>
          </div>

          {dueParties.map(({ party, balance }) => (
              <button
                className="outstanding-row"
                key={party.id}
                onClick={() =>
                  go(`parties/${party.id}`)
                }
              >
                <span>
                  <strong>{party.name}</strong>
                  <small>{party.location}</small>
                </span>

                <b>
                  {money(balance)}
                </b>
              </button>
            ))}
          {dueParties.length === 0 && (
            <p className="empty-state">{period === "lifetime" ? "No outstanding balances." : "No outstanding balances as of this date."}</p>
          )}
        </section>
      </div>
    </>
  );
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

  const shown = parties.filter((party) =>
    `${party.name} ${party.company ?? ""} ${
      party.contact ?? ""
    }`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <>
      <Header
        eyebrow="DIRECTORY"
        title="Parties"
        description="Manage the suppliers, retailers, and customers in your ledger."
        action={() => go("add-party")}
        label="Add party"
      />

      <div className="filter-bar">
        <Search size={16} />

        <input
          aria-label="Search parties"
          placeholder="Search by name, company, or phone"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
        />
      </div>

      <section className="reference-panel table-panel">
        <div className="party-row party-head">
          <span>PARTY</span>
          <span>CONTACT</span>
          <span>LOCATION</span>
          <span>BALANCE</span>
          <span />
        </div>

        {shown.map((party) => {
          const balance = balanceOf(
            entries,
            party.id,
          );

          return (
            <button
              className="party-row party-button"
              key={party.id}
              onClick={() =>
                go(`parties/${party.id}`)
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
            {query ? "No parties match your search." : "No parties yet. Add a party to start recording transactions."}
          </p>
        )}
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

    setSaving(true);
    setError("");

    const success = await save(form);

    setSaving(false);

    if (success) {
      go("parties");
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
        description="Create an account for a supplier, retailer, or customer."
        action={() => go("parties")}
        label="Back to parties"
      />

      <form
        className="form-panel"
        onSubmit={submit}
      >
        <h2>Party information</h2>

        <div className="form-grid">
          <FormField label="Name *">
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
              value={form.contact}
              onChange={(event) =>
                setForm({
                  ...form,
                  contact: event.target.value,
                })
              }
            />
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
          <p className="form-error">{error}</p>
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
  save,
}: {
  parties: Party[];
  save: (
    entry: Omit<Entry, "id"> & { paidNow?: number },
  ) => Promise<boolean>;
}) {
  const params = new URLSearchParams(
    window.location.search,
  );

  const initialParty =
    params.get("party") ?? "";

  const [form, setForm] = useState({
    partyId: initialParty,
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

  const [partiallyPaid, setPartiallyPaid] = useState(false);

  const purchaseCents = Math.round(Number(form.amount || 0) * 100);
  const paidNowCents = partiallyPaid ? Math.round(Number(form.paidNow || 0) * 100) : 0;
  const remainingCents = Math.max(0, purchaseCents - paidNowCents);
  const invalidPaidNow = form.type === "PURCHASE" && partiallyPaid && (paidNowCents <= 0 || paidNowCents >= purchaseCents);

  const submit = async (
    event: FormEvent,
  ) => {
    event.preventDefault();

    if (
      !form.partyId ||
      !form.amount ||
      !form.bs ||
      !form.ad
    ) {
      return;
    }

    if (invalidPaidNow) {
      setError("Enter a partial payment greater than zero and less than the purchase total.");
      return;
    }

    setSaving(true);
    setError("");

    const success = await save({
      partyId: form.partyId,
      type: form.type,
      amount: Number(form.amount),
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
        description="Record a purchase, an immediate part payment, or a later payment. Party balances update automatically."
        action={() => go("transactions")}
        label="View transactions"
      />

      <form
        className="form-panel"
        onSubmit={submit}
      >
        <h2>Transaction details</h2>

        {parties.length === 0 && (
          <div className="form-notice">
            Add a party before recording a transaction.
            <button type="button" className="text-link" onClick={() => go("add-party")}>Add party <ArrowRight size={14} /></button>
          </div>
        )}

        <div className="form-grid transaction-form-grid">
          <FormField label="Party *">
            <select
              required
              value={form.partyId}
              onChange={(event) =>
                setForm({
                  ...form,
                  partyId:
                    event.target.value,
                })
              }
            >
              <option value="">
                Select a party
              </option>

              {parties.map((party) => (
                <option
                  key={party.id}
                  value={party.id}
                >
                  {party.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Transaction type *">
            <select
              value={form.type}
              onChange={(event) => {
                setForm({ ...form, type: event.target.value as EntryType, paidNow: "" });
                setPartiallyPaid(false);
              }}
            >
              <option value="PURCHASE">
                Purchase
              </option>

              <option value="PAYMENT">
                Payment received
              </option>
            </select>
          </FormField>

          <div className="amount-column">
            <FormField label={form.type === "PURCHASE" ? "Purchase total (NPR) *" : "Payment amount (NPR) *"}>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                placeholder="0.00"
              />
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
                  <span>Partially paid</span>
                </label>
                {partiallyPaid && (
                  <FormField label="Payment received now (NPR) *">
                    <input
                      required
                      type="number"
                      min="0.01"
                      max={form.amount || undefined}
                      step="0.01"
                      value={form.paidNow}
                      onChange={(event) => setForm({ ...form, paidNow: event.target.value })}
                      placeholder="0.00"
                    />
                    <small>Enter the amount received now. The rest stays outstanding.</small>
                    {form.paidNow && invalidPaidNow && <small className="field-error">Enter less than the purchase total.</small>}
                  </FormField>
                )}
              </>
            )}
          </div>

          <div className="form-field">
            <span>Nepali date (BS) *</span>
            <NepaliDatePicker
              value={form.bs}
              onChange={(bs, ad) => setForm({ ...form, bs, ad })}
            />
            <small>Select a date from the Nepali calendar.</small>
          </div>

        </div>

        {form.type === "PURCHASE" && purchaseCents > 0 && (
          <div className="payment-preview" aria-live="polite">
            <div><span>Purchase total</span><strong>{money(purchaseCents / 100)}</strong></div>
            <div><span>Paid now</span><strong>{money(paidNowCents / 100)}</strong></div>
            <div><span>Remaining from this purchase</span><strong>{money(remainingCents / 100)}</strong></div>
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
            placeholder="What was purchased or paid?"
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
}: {
  parties: Party[];
  entries: Entry[];
}) {
  const [query, setQuery] =
    useState("");

  const [type, setType] =
    useState("all");

  const [from, setFrom] =
    useState("");

  const [to, setTo] =
    useState("");

  const shown = entries.filter(
    (entry) => {
      const party = parties.find(
        (item) =>
          item.id === entry.partyId,
      );

      const text =
        `${party?.name ?? ""} ${
          party?.company ?? ""
        } ${entry.description}`.toLowerCase();

      return (
        (!query ||
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

  return (
    <>
      <Header
        eyebrow="LEDGER / ALL TRANSACTIONS"
        title="Transactions"
        description="Review purchases and payments. Filter the list or export the current results."
        action={() => go("add-entry")}
        label="New transaction"
      />

      <div className="transaction-actions">
        <button
          className="outline-button"
          disabled={shown.length === 0}
          onClick={() => {
            const csvCell = (value: string | number) =>
              `"${String(value).replaceAll('"', '""')}"`;
            const csv = [
              "date_bs,party,type,amount,description",
              ...shown.map(
                (entry) =>
                  [entry.bs, partyName(
                    parties,
                    entry.partyId,
                  ), entry.type, entry.amount, entry.description]
                    .map(csvCell).join(","),
              ),
            ].join("\n");

            const link =
              document.createElement("a");

            link.href =
              URL.createObjectURL(
                new Blob([csv], {
                  type: "text/csv",
                }),
              );

            link.download =
              "rkh-ledger.csv";

            link.click();

            URL.revokeObjectURL(
              link.href,
            );
          }}
        >
          <Download size={15} />
          Export results
        </button>
      </div>

      <div className="filter-bar transaction-filters">
        <Search size={16} />

        <input
          aria-label="Search transactions"
          placeholder="Search party or description"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
        />

        <select
          aria-label="Filter transaction type"
          value={type}
          onChange={(event) =>
            setType(event.target.value)
          }
        >
          <option value="all">
            All types
          </option>

          <option value="PURCHASE">
            Purchases
          </option>

          <option value="PAYMENT">
            Payments
          </option>
        </select>

        <input
          aria-label="From Nepali date"
          placeholder="From BS (YYYY-MM-DD)"
          value={from}
          onChange={(event) =>
            setFrom(event.target.value)
          }
        />

        <input
          aria-label="To Nepali date"
          placeholder="To BS (YYYY-MM-DD)"
          value={to}
          onChange={(event) =>
            setTo(event.target.value)
          }
        />
      </div>

      <section className="reference-panel table-panel">
        <Table
          entries={shown}
          parties={parties}
          emptyMessage={entries.length === 0 ? "No transactions yet. Add a transaction to start your ledger." : "No transactions match these filters."}
        />
      </section>
    </>
  );
}

/* =========================================================
   EDIT PARTY
   ========================================================= */

function EditParty({
  party,
  save,
}: {
  party: Party;
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

    setSaving(true);
    setError("");

    const success =
      await save(form);

    setSaving(false);

    if (success) {
      go(`parties/${party.id}`);
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
        description="Update this party's account and contact details."
        action={() =>
          go(`parties/${party.id}`)
        }
        label="Back to party"
      />

      <form
        className="form-panel"
        onSubmit={submit}
      >
        <h2>Party information</h2>

        <div className="form-grid">
          <FormField label="Name *">
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
              value={
                form.contact || ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  contact:
                    event.target.value,
                })
              }
            />
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
          <p className="form-error">{error}</p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="outline-button"
            onClick={() =>
              go(`parties/${party.id}`)
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

function PartyDetail({
  party,
  entries,
  edit,
  remove,
}: {
  party: Party;
  entries: Entry[];
  edit: () => void;
  remove: () => void;
}) {
  const rows = entries.filter(
    (entry) =>
      entry.partyId === party.id,
  );

  const purchased = rows
    .filter(
      (entry) =>
        entry.type === "PURCHASE",
    )
    .reduce(
      (sum, entry) =>
        sum + entry.amount,
      0,
    );

  const paid = rows
    .filter(
      (entry) =>
        entry.type === "PAYMENT",
    )
    .reduce(
      (sum, entry) =>
        sum + entry.amount,
      0,
    );

  return (
    <div className="party-detail">
      <Header
        eyebrow="PARTY ACCOUNT"
        title={party.name}
        description={
          party.company ||
          "Account overview and transaction history"
        }
        action={() =>
          go(
            `add-entry?party=${party.id}`,
          )
        }
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
          <button className="outline-button" onClick={edit}>Edit party</button>
          <button className="delete-button" onClick={remove}>
            <Trash2 size={14} />
            Delete party
          </button>
        </div>
      </div>

      <section className="summary-grid">
        <div>
          <span>Purchases</span>
          <strong>
            {money(purchased)}
          </strong>
        </div>

        <div>
          <span>Payments</span>
          <strong>{money(paid)}</strong>
        </div>

        <div>
          <span>
            Outstanding balance
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
        </div>

        <Table
          entries={rows}
          parties={[party]}
          emptyMessage="No transactions for this party yet."
        />
      </section>
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
      <div className="login-shell">
        <section className="login-brand">
          <div>
            <span className="login-logo">
              RKH
            </span>

            <p className="login-kicker">
              RKH SUPPLIERS
            </p>

            <h1>
              Your business ledger.
            </h1>

            <p className="login-intro">
              Keep purchases, payments, and party balances organized in one secure place.
            </p>
          </div>

          <div className="login-brand-footer">
            <span>
              FAMILY BUSINESS
            </span>

            <span>
              KATHMANDU, NEPAL
            </span>
          </div>
        </section>

        <section className="login-form-side">
          <form
            className="login-panel"
            onSubmit={submit}
          >
            <div className="login-heading">
              <span className="login-kicker">
                PRIVATE ACCESS
              </span>

              <h2>Sign in</h2>

              <p>
                Use your account credentials to access the ledger.
              </p>
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

                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                />
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
          </form>
        </section>
      </div>
    </div>
  );
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

  /* AUTH */

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setAuthenticated(
          Boolean(data.session),
        );
      });

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setAuthenticated(
            Boolean(session),
          );
        },
      );

    return () =>
      subscription.unsubscribe();
  }, []);

  /* LOAD DATABASE */

  const loadData = async () => {
    setLoadingData(true);
    setDataError("");

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
    if (authenticated) {
      loadData();
    } else if (
      authenticated === false
    ) {
      setParties([]);
      setEntries([]);
    }
  }, [authenticated]);

  /* ADD PARTY */

  const addParty = async (
    party: Omit<Party, "id">,
  ): Promise<boolean> => {
    const { data, error } =
      await supabase
        .from("parties")
        .insert({
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
        .select()
        .single();

    if (error) {
      console.error(error);

      return false;
    }

    setParties((items) => [
      ...items,

      {
        id: data.id,
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
    if (
      !window.confirm(
        `Delete ${party.name}? This will permanently delete the party and ALL of its transaction history. This cannot be undone.`,
      )
    ) {
      return;
    }

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

  /* ADD TRANSACTION */

  const addEntry = async (
    entry: Omit<Entry, "id"> & { paidNow?: number },
  ): Promise<boolean> => {
    const paidNow = Math.round((entry.paidNow ?? 0) * 100) / 100;
    if (entry.type === "PURCHASE" && (paidNow < 0 || paidNow > entry.amount)) {
      return false;
    }

    const transactionRows: Array<{
      party_id: string;
      type: EntryType;
      amount: number;
      date_ad: string;
      date_bs: string;
      description: string | null;
    }> = [{
      party_id: entry.partyId,
      type: entry.type,
      amount: entry.amount,
      date_ad: entry.ad,
      date_bs: entry.bs,
      description: entry.description.trim() || null,
    }];

    if (entry.type === "PURCHASE" && paidNow > 0) {
      transactionRows.push({
        party_id: entry.partyId,
        type: "PAYMENT",
        amount: paidNow,
        date_ad: entry.ad,
        date_bs: entry.bs,
        description: "Payment received with purchase",
      });
    }

    const { data, error } =
      await supabase
        .from("transactions")
        .insert(transactionRows)
        .select();

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

    const name = partyName(parties, entry.partyId);
    if (entry.type === "PURCHASE" && paidNow > 0) {
      showNotice("Purchase and payment recorded", `${money(paidNow)} paid now · ${money(entry.amount - paidNow)} remaining for ${name}`);
    } else {
      showNotice(
        entry.type === "PAYMENT" ? "Payment received" : "Purchase recorded",
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

  /* AUTH LOADING */

  if (authenticated === null) {
    return (
      <div className="login-page">
        <p>
          Loading RKH Suppliers...
        </p>
      </div>
    );
  }

  /* LOGIN */

  if (!authenticated) {
    return <Login />;
  }

  /* DATABASE LOADING */

  if (loadingData) {
    return (
      <div className="login-page">
        <p>Loading ledger...</p>
      </div>
    );
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

  let page: ReactNode = (
    <Dashboard
      parties={parties}
      entries={entries}
    />
  );

  if (
    current.path === "parties" &&
    current.id
  ) {
    const party = parties.find(
      (item) =>
        item.id === current.id,
    );

    if (party) {
      page = (
        <PartyDetail
          party={party}
          entries={entries}
          edit={() =>
            go(
              `edit-party/${party.id}`,
            )
          }
          remove={() =>
            deleteParty(party)
          }
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
      />
    );
  }

  return (
    <>
      <Shell active={current.path} onLogout={logout}>
        {page}
      </Shell>
      <ActionNotice notice={notice} dismiss={() => setNotice(null)} />
    </>
  );
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
