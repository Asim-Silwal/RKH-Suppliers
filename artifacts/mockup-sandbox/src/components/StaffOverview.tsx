import { useEffect, useState } from "react";
import { Search, UsersRound, Wallet } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./StaffOverview.css";

type CustomerBalance = { party_id: string; customer_name: string; remaining_balance: number | string };
const money = (value: number) => `NPR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function StaffOverview() {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error: loadError } = await supabase.rpc("staff_customer_balances");
      if (cancelled) return;
      setError(loadError?.message ?? "");
      setCustomers((data ?? []) as CustomerBalance[]);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  const total = customers.reduce((sum, item) => sum + Number(item.remaining_balance), 0);
  const filtered = customers.filter((item) => item.customer_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const filteredTotal = filtered.reduce((sum, item) => sum + Number(item.remaining_balance), 0);
  return <div className="staff-overview">
    <header className="reference-header"><div><span className="eyebrow">CUSTOMER ACCOUNTS</span><h1>Customer balances</h1><p>Find a customer and see their remaining balance.</p></div></header>
    {loading ? <section className="reference-panel staff-balance-state">Loading customer balances...</section>
      : error ? <section className="reference-panel staff-balance-state" role="alert">{error}</section>
      : <><div className="staff-balance-stats"><section className="staff-balance-highlight"><div className="staff-stat-icon"><Wallet size={20} /></div><span>Total remaining</span><strong>{money(total)}</strong><small>Across all customers</small></section><section className="staff-balance-count"><div className="staff-stat-icon"><UsersRound size={20} /></div><span>Customers</span><strong>{customers.length}</strong><small>Customer accounts</small></section></div>
        <section className="reference-panel staff-balance-list"><div className="staff-balance-list-top"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Remaining by customer</h2></div><label className="staff-search"><Search size={17} /><input type="search" aria-label="Search customers" placeholder="Search customers..." value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
          <div className="staff-list-summary"><span>{query.trim() ? `${filtered.length} matching customers` : `${customers.length} customers`}</span>{query.trim() && <span>Matching total <strong>{money(filteredTotal)}</strong></span>}</div>
          <div className="staff-customer-table"><div className="staff-customer-header"><span>Customer</span><span>Remaining balance</span></div>{filtered.map((customer) => <div className="staff-customer-row" key={customer.party_id}><div className="staff-customer-identity"><span className="staff-customer-avatar">{customer.customer_name.trim().charAt(0).toUpperCase()}</span><strong>{customer.customer_name}</strong></div><strong>{money(Number(customer.remaining_balance))}</strong></div>)}</div>
          {filtered.length === 0 && <p className="staff-empty">{query.trim() ? `No customers match “${query.trim()}”.` : "No customer balances found."}</p>}
        </section></>}
  </div>;
}
