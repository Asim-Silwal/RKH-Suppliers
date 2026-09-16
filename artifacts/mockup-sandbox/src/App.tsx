import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  ArrowRight,
  CalendarDays,
  Check,
  Download,
  FileText,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";

import { supabase } from "./lib/supabase";

type EntryType = "PURCHASE" | "PAYMENT";

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
    ["parties", "Add party", UsersRound],
    ["add-entry", "Main entry", Plus],
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
          <span>FAMILY BUSINESS / KATHMANDU</span>

          <small>Records are kept private.</small>

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

        {action && label === "Back to parties" && (
          <button className="back-link" onClick={action}>
            Back to parties
          </button>
        )}
      </div>

      {action && label !== "Back to parties" && (
        <button className="black-button" onClick={action}>
          <Plus size={15} />
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
}: {
  entries: Entry[];
  parties: Party[];
}) {
  return (
    <div className="ledger-table">
      <div className="ledger-row ledger-head">
        <span>DATE</span>
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
            {entry.type}
          </span>

          <span>{entry.description}</span>

          <strong>{money(entry.amount)}</strong>
        </div>
      ))}
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
  const purchased = entries
    .filter((entry) => entry.type === "PURCHASE")
    .reduce((sum, entry) => sum + entry.amount, 0);

  const collected = entries
    .filter((entry) => entry.type === "PAYMENT")
    .reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <>
      <Header
        eyebrow="DAILY LEDGER"
        title="Dashboard"
        description="A clear view of what has moved, what is owed, and what needs your attention."
        action={() => go("add-entry")}
        label="Main entry"
      />

      <section className="summary-grid">
        <div>
          <span>Total money to be collected</span>

          <strong>
            {money(Math.max(0, purchased - collected))}
          </strong>

          <small>Outstanding across all parties</small>
        </div>

        <div>
          <span>Total money collected</span>

          <strong>{money(collected)}</strong>

          <small>Payments received</small>
        </div>

        <div>
          <span>Total purchased</span>

          <strong>{money(purchased)}</strong>

          <small>Goods recorded</small>
        </div>

        <div>
          <span>Total parties</span>

          <strong>{parties.length}</strong>

          <small>In the directory</small>
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="reference-panel">
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
              View all
              <ArrowRight size={14} />
            </button>
          </div>

          <Table
            entries={entries.slice(0, 10)}
            parties={parties}
          />
        </section>

        <section className="reference-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                FOLLOW-UP
              </span>

              <h2>Money to be collected</h2>
            </div>

            <button
              className="text-link"
              onClick={() => go("parties")}
            >
              View all
              <ArrowRight size={14} />
            </button>
          </div>

          {parties
            .filter(
              (party) =>
                balanceOf(entries, party.id) > 0,
            )
            .map((party) => (
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
                  {money(
                    balanceOf(entries, party.id),
                  )}
                </b>
              </button>
            ))}
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
        eyebrow="PARTY DIRECTORY"
        title="Add party"
        description="Keep one clear record for every supplier, retailer, or customer."
        action={() => go("add-party")}
        label="Add party"
      />

      <div className="filter-bar">
        <Search size={16} />

        <input
          aria-label="Search parties"
          placeholder="Search name, company, or contact"
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
                  : "Settled"}
              </strong>

              <ArrowRight size={15} />
            </button>
          );
        })}
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
        eyebrow="PARTY DIRECTORY / NEW"
        title="Add party"
        description="Enter the party information you currently keep on paper."
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
              placeholder="Party name"
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
              placeholder="Location"
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
              ? "Saving..."
              : "Save party"}
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
    entry: Omit<Entry, "id">,
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
    bs: "",
    ad: new Date()
      .toISOString()
      .slice(0, 10),
    description: "",
  });

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

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

    setSaving(true);
    setError("");

    const success = await save({
      partyId: form.partyId,
      type: form.type,
      amount: Number(form.amount),
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
        eyebrow="MAIN ENTRY / NEW"
        title="Main entry"
        description="Record one purchase or one payment. The balance is recalculated from every entry."
        action={() => go("transactions")}
        label="View transactions"
      />

      <form
        className="form-panel"
        onSubmit={submit}
      >
        <h2>Entry details</h2>

        <div className="form-grid">
          <FormField label="Select party *">
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
                Choose a party
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

          <FormField label="Entry type *">
            <select
              value={form.type}
              onChange={(event) =>
                setForm({
                  ...form,
                  type: event.target
                    .value as EntryType,
                })
              }
            >
              <option value="PURCHASE">
                Purchased amount
              </option>

              <option value="PAYMENT">
                Money given / paid
              </option>
            </select>
          </FormField>

          <FormField label="Amount (NPR) *">
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) =>
                setForm({
                  ...form,
                  amount:
                    event.target.value,
                })
              }
              placeholder="0.00"
            />
          </FormField>

          <FormField label="Date (Bikram Sambat) *">
            <div className="date-input">
              <input
                required
                pattern="20[0-9]{2}-[0-9]{2}-[0-9]{2}"
                placeholder="YYYY-MM-DD"
                value={form.bs}
                onChange={(event) =>
                  setForm({
                    ...form,
                    bs: event.target.value,
                  })
                }
              />

              <CalendarDays size={15} />
            </div>

            <small>
              Format: YYYY-MM-DD BS
            </small>
          </FormField>

          <FormField label="AD date *">
            <input
              required
              type="date"
              value={form.ad}
              onChange={(event) =>
                setForm({
                  ...form,
                  ad: event.target.value,
                })
              }
            />
          </FormField>
        </div>

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
            placeholder="Goods purchased, payment reference, or notes"
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
            disabled={saving}
          >
            <Check size={15} />

            {saving
              ? "Saving..."
              : "Save entry"}
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
        eyebrow="LEDGER / ALL ENTRIES"
        title="Transactions"
        description="Search and filter every purchase and payment in the business."
        action={() => go("add-entry")}
        label="Main entry"
      />

      <div className="transaction-actions">
        <button
          className="outline-button"
          onClick={() => {
            const csv = [
              "date_bs,party,type,amount,description",
              ...shown.map(
                (entry) =>
                  `${entry.bs},${partyName(
                    parties,
                    entry.partyId,
                  )},${entry.type},${
                    entry.amount
                  },${
                    entry.description
                  }`,
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
          Export CSV
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
            All entries
          </option>

          <option value="PURCHASE">
            Purchased
          </option>

          <option value="PAYMENT">
            Money given
          </option>
        </select>

        <input
          aria-label="From Nepali date"
          placeholder="From BS · YYYY-MM-DD"
          value={from}
          onChange={(event) =>
            setFrom(event.target.value)
          }
        />

        <input
          aria-label="To Nepali date"
          placeholder="To BS · YYYY-MM-DD"
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
        eyebrow="PARTY DIRECTORY / EDIT"
        title="Edit party"
        description="Update the contact information for this party."
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
              ? "Saving..."
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
    <>
      <Header
        eyebrow="PARTY LEDGER"
        title={party.name}
        description={
          party.company ||
          "Party account"
        }
        action={() =>
          go(
            `add-entry?party=${party.id}`,
          )
        }
        label="Add transaction"
      />

      <button
        className="back-link"
        onClick={() => go("parties")}
      >
        Back to parties
      </button>

      <div className="party-actions">
        <button
          className="outline-button"
          onClick={edit}
        >
          Edit party
        </button>

        <button
          className="delete-button"
          onClick={remove}
        >
          <Trash2 size={14} />
          Delete party
        </button>
      </div>

      <section className="summary-grid">
        <div>
          <span>Total purchased</span>
          <strong>
            {money(purchased)}
          </strong>
        </div>

        <div>
          <span>Total paid</span>
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
          <span>Credit / advance</span>

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

      <section className="party-info reference-panel">
        <div>
          <span>CONTACT</span>
          <b>
            {party.contact || "—"}
          </b>
        </div>

        <div>
          <span>LOCATION</span>
          <b>
            {party.location || "—"}
          </b>
        </div>

        <div>
          <span>NOTES</span>
          <b>
            {party.notes || "No notes"}
          </b>
        </div>
      </section>

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
        />
      </section>
    </>
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
              Private business ledger.
            </h1>

            <p className="login-intro">
              Purchases, payments and
              party balances — kept
              together in one private
              record.
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
                Enter your account
                details to open the
                ledger.
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
              Private access for RKH
              Suppliers.
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
      window.alert(error.message);

      return;
    }

    setParties((items) =>
      items.filter(
        (item) =>
          item.id !== party.id,
      ),
    );

    go("parties");
  };

  /* ADD TRANSACTION */

  const addEntry = async (
    entry: Omit<Entry, "id">,
  ): Promise<boolean> => {
    const { data, error } =
      await supabase
        .from("transactions")
        .insert({
          party_id:
            entry.partyId,

          type: entry.type,

          amount: entry.amount,

          date_ad: entry.ad,

          date_bs: entry.bs,

          description:
            entry.description.trim() ||
            null,
        })
        .select()
        .single();

    if (error) {
      console.error(error);

      return false;
    }

    const saved: Entry = {
      id: data.id,

      partyId: data.party_id,

      type:
        data.type as EntryType,

      amount: Number(data.amount),

      ad: data.date_ad,

      bs: data.date_bs,

      description:
        data.description ?? "",
    };

    setEntries((items) => [
      saved,
      ...items,
    ]);

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
    <Shell
      active={current.path}
      onLogout={logout}
    >
      {page}
    </Shell>
  );
}