import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { adToBs } from "../lib/kathmanduTime";
import "./UserManagement.css";

export type UserRole = "admin" | "manager" | "staff";
export type Permission = "ledger_view" | "parties_write" | "parties_delete" | "transactions_write" | "transactions_delete" | "reports_view" | "sahakari_view" | "sahakari_record" | "sahakari_edit" | "staff_balances_view";
export type AppRole = { role_key: UserRole; name: string; permissions: Permission[] };
type AppUser = { user_id: string; email: string; full_name: string | null; role_key: UserRole; created_at: string };

const descriptions: Record<Permission, string> = {
  ledger_view: "View the full ledger",
  parties_write: "Add and edit parties",
  parties_delete: "Delete parties",
  transactions_write: "Add and edit transactions",
  transactions_delete: "Delete transactions",
  reports_view: "View reports",
  sahakari_view: "View Sahakari",
  sahakari_record: "Record today's Sahakari deposit once",
  sahakari_edit: "Edit saved Sahakari records",
  staff_balances_view: "View customer names and outstanding balances only",
};

export function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "staff">("staff");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [userResult, roleResult] = await Promise.all([
      supabase.rpc("list_app_users"),
      supabase.from("app_roles").select("role_key, name, permissions").order("name"),
    ]);
    if (userResult.error || roleResult.error) {
      setError(userResult.error?.message ?? roleResult.error?.message ?? "Could not load users and roles.");
    } else {
      setUsers((userResult.data ?? []) as AppUser[]);
      setRoles((roleResult.data ?? []) as AppRole[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const { data, error: inviteError } = await supabase.functions.invoke("create-user", {
      body: { email: email.trim(), fullName: fullName.trim(), role: inviteRole },
    });
    if (inviteError || data?.error) setError(data?.error ?? inviteError?.message ?? "Could not invite user.");
    else {
      setMessage(`Invitation sent to ${email.trim()} with ${inviteRole} access.`);
      setEmail(""); setFullName("");
      await refresh();
    }
    setBusy(false);
  };

  const assignRole = async (user: AppUser, roleKey: "manager" | "staff") => {
    setBusy(true); setError(""); setMessage("");
    const { error: assignError } = await supabase.rpc("assign_app_role", {
      target_user: user.user_id, target_role: roleKey,
    });
    if (assignError) setError(assignError.message);
    else {
      setMessage(`${user.full_name || user.email} is now ${roleKey}.`);
      await refresh();
    }
    setBusy(false);
  };

  return <div className="user-management">
    <header className="reference-header"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Users & roles</h1><p>Only the account owner can view or change users.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="user-create-success" role="status">{message}</p>}
    {loading ? <section className="form-panel">Loading users and roles...</section> : <>
      <section className="form-panel user-management-panel">
        <div className="user-panel-heading"><h2>Users</h2><span>{users.length} users</span></div>
        <div className="user-list">{users.map((user) => <div className="user-row" key={user.user_id}>
          <div><strong>{user.full_name?.trim() || user.email}</strong><small>{user.email}</small><small>Added {adToBs(user.created_at.slice(0, 10))} BS</small></div>
          <label>Role<select value={user.role_key} disabled={busy || user.user_id === currentUserId} onChange={(event) => void assignRole(user, event.target.value as "manager" | "staff")}>
            {roles.map((role) => <option key={role.role_key} value={role.role_key} disabled={role.role_key === "admin" && user.user_id !== currentUserId}>{role.name}</option>)}
          </select></label>
        </div>)}</div>
      </section>
      <section className="form-panel user-management-panel">
        <div className="user-panel-heading"><h2>Add user</h2><span>Invitation by email</span></div>
        <form className="user-create-form" onSubmit={(event) => void invite(event)}>
          <label><span>Email address *</span><input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Full name</span><input value={fullName} autoComplete="off" maxLength={120} onChange={(event) => setFullName(event.target.value)} /></label>
          <label><span>Role *</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "manager" | "staff")}><option value="manager">Manager</option><option value="staff">Staff</option></select></label>
          <button className="black-button" type="submit" disabled={busy}>{busy ? "Working..." : "Send invitation"}</button>
        </form>
      </section>
      <section className="form-panel user-management-panel">
        <div className="user-panel-heading"><h2>Role permissions</h2><span>Admin is reserved for you</span></div>
        <div className="user-role-list">{roles.map((role) => <div className="user-role-card" key={role.role_key}>
          <strong>{role.name}</strong>
          <ul>{role.permissions.map((permission) => <li key={permission}>{descriptions[permission]}</li>)}</ul>
        </div>)}</div>
      </section>
    </>}
  </div>;
}
