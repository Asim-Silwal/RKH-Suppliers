import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./StaffOverview.css";

type CustomerBalance = { party_id: string; customer_name: string; remaining_balance: number | string };
const money = (value: number) => `NPR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function StaffOverview() {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  return <div className="staff-overview">
    <header className="reference-header"><div><span className="eyebrow">CUSTOMER BALANCES</span><h1>Remaining balances</h1><p>Customer names and outstanding amounts.</p></div></header>
    {loading ? <section className="reference-panel staff-balance-state">Loading customer balances...</section>
      : error ? <section className="reference-panel staff-balance-state" role="alert">{error}</section>
      : <><section className="reference-panel staff-balance-total"><span>Total remaining</span><strong>{money(total)}</strong></section>
        <section className="reference-panel staff-balance-list"><h2>Customers</h2>
          {customers.map((customer) => <div key={customer.party_id}><span>{customer.customer_name}</span><strong>{money(Number(customer.remaining_balance))}</strong></div>)}
          {customers.length === 0 && <p>No customer balances found.</p>}
        </section></>}
  </div>;
}
