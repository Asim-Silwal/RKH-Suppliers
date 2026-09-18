import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, KeyRound, Plus, Shield, Trash2, UsersRound, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { adToBs } from "../lib/kathmanduTime";
import "./UserManagement.css";

export type UserRole = string;
export type Permission = "ledger_view" | "parties_write" | "parties_delete" | "transactions_write" | "transactions_delete" | "reports_view" | "sahakari_view" | "sahakari_record" | "sahakari_edit" | "staff_balances_view";
export type AppRole = { role_key: UserRole; name: string; permissions: Permission[]; is_system: boolean };
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
const permissionOrder: Permission[] = ["ledger_view", "parties_write", "parties_delete", "transactions_write", "transactions_delete", "reports_view", "sahakari_view", "sahakari_record", "sahakari_edit", "staff_balances_view"];

export function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [newPermissions, setNewPermissions] = useState<Permission[]>(["ledger_view"]);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingPermissions, setEditingPermissions] = useState<Permission[]>([]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetUser, setResetUser] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newCredential, setNewCredential] = useState<{ email: string; password: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [userResult, roleResult] = await Promise.all([
      supabase.rpc("list_app_users"),
      supabase.from("app_roles").select("role_key, name, permissions, is_system").order("name"),
    ]);
    if (userResult.error || roleResult.error) {
      setError(userResult.error?.message ?? roleResult.error?.message ?? "Could not load users and roles.");
    } else {
      setUsers((userResult.data ?? []) as AppUser[]);
      const nextRoles = (roleResult.data ?? []) as AppRole[];
      setRoles(nextRoles);
      setInviteRole((current) => nextRoles.some((role) => role.role_key === current && current !== "admin") ? current : nextRoles.find((role) => role.role_key !== "admin")?.role_key ?? "");
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const { data, error: inviteError } = await supabase.functions.invoke("create-user", {
      body: { email: email.trim(), fullName: fullName.trim(), role: inviteRole, password },
    });
    if (inviteError || data?.error) setError(data?.error ?? inviteError?.message ?? "Could not create user.");
    else {
      setNewCredential({ email: email.trim(), password });
      setMessage(`${email.trim()} was created with ${inviteRole} access. Copy the password now; it cannot be retrieved later.`);
      setEmail(""); setFullName(""); setPassword(""); setShowPassword(false);
      setAddUserOpen(false);
      await refresh();
    }
    setBusy(false);
  };

  const saveNewPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetUser) return;
    setBusy(true); setError(""); setMessage("");
    const { data, error: functionError } = await supabase.functions.invoke("set-user-password", {
      body: { userId: resetUser.user_id, password: resetPassword },
    });
    if (functionError || data?.error) setError(data?.error ?? functionError?.message ?? "Could not set password.");
    else {
      setNewCredential({ email: resetUser.email, password: resetPassword });
      setMessage(`Password changed for ${resetUser.full_name || resetUser.email}. Copy the new password now; it cannot be retrieved later.`);
      setResetUser(null); setResetPassword(""); setShowResetPassword(false);
    }
    setBusy(false);
  };

  const copyCredential = async () => {
    if (!newCredential) return;
    try {
      await navigator.clipboard.writeText(`Email: ${newCredential.email}\nPassword: ${newCredential.password}`);
      setMessage("Login details copied. Share them with the user through your chosen channel.");
    } catch { setError("Could not copy. Select the details and copy them manually."); }
  };

  const assignRole = async (user: AppUser, roleKey: string) => {
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

  const deleteUser = async (user: AppUser) => {
    if (!window.confirm(`Permanently delete ${user.full_name || user.email}? They will lose access, while recorded Sahakari history remains.`)) return;
    setBusy(true); setError(""); setMessage("");
    const { data, error: functionError } = await supabase.functions.invoke("delete-user", { body: { userId: user.user_id } });
    if (functionError || data?.error) setError(data?.error ?? functionError?.message ?? "Could not delete user.");
    else {
      setMessage(`${user.full_name || user.email} was deleted.`);
      if (resetUser?.user_id === user.user_id) setResetUser(null);
      await refresh();
    }
    setBusy(false);
  };

  const togglePermission = (key: Permission, current: Permission[], set: (next: Permission[]) => void) => {
    if (key === "staff_balances_view") { set(["staff_balances_view"]); return; }
    const base: Permission[] = current.filter((item) => item !== "staff_balances_view");
    let next = base.includes(key) ? base.filter((item) => item !== key) : [...base, key];
    if (!next.includes("ledger_view")) next = ["ledger_view", ...next];
    if (key === "sahakari_view" && !next.includes(key)) next = next.filter((item) => item !== "sahakari_record" && item !== "sahakari_edit");
    if ((key === "sahakari_record" || key === "sahakari_edit") && next.includes(key) && !next.includes("sahakari_view")) next.push("sahakari_view");
    set(permissionOrder.filter((permission) => next.includes(permission)));
  };

  const permissionPicker = (current: Permission[], set: (next: Permission[]) => void) => <div className="user-permission-picker">
    {permissionOrder.map((key) => <label key={key}><input type="checkbox" checked={current.includes(key)} disabled={busy || (key === "ledger_view" && current.includes("ledger_view"))} onChange={() => togglePermission(key, current, set)} /><span>{descriptions[key]}</span></label>)}
  </div>;

  const createRole = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const { error: createError } = await supabase.rpc("create_app_role", { role_name: roleName.trim(), role_permissions: newPermissions });
    if (createError) setError(createError.message);
    else {
      setMessage(`Role ${roleName.trim()} created.`);
      setRoleName(""); setNewPermissions(["ledger_view"]);
      setNewRoleOpen(false); setActiveTab("roles");
      await refresh();
    }
    setBusy(false);
  };

  const saveRole = async (role: AppRole) => {
    setBusy(true); setError(""); setMessage("");
    const { error: updateError } = await supabase.rpc("update_app_role_details", { target_role: role.role_key, role_name: editingName.trim(), role_permissions: editingPermissions });
    if (updateError) setError(updateError.message);
    else {
      setMessage(`${editingName.trim()} role updated.`);
      setEditingRole(null);
      await refresh();
    }
    setBusy(false);
  };

  const deleteRole = async (role: AppRole) => {
    const assignedCount = users.filter((user) => user.role_key === role.role_key).length;
    if (assignedCount) { setError(`Move ${assignedCount} user${assignedCount === 1 ? "" : "s"} to another role before deleting ${role.name}.`); return; }
    if (!window.confirm(`Delete the ${role.name} role? Move its users to another role first.`)) return;
    setBusy(true); setError(""); setMessage("");
    const { error: deleteError } = await supabase.rpc("delete_app_role", { target_role: role.role_key });
    if (deleteError) setError(deleteError.message);
    else {
      setMessage(`${role.name} role deleted.`);
      if (inviteRole === role.role_key) setInviteRole("staff");
      await refresh();
    }
    setBusy(false);
  };

  const panelOpen = addUserOpen || newRoleOpen || Boolean(resetUser);
  const assignableRoles = roles.filter((role) => role.role_key !== "admin");
  const closePanel = () => { if (busy) return; setAddUserOpen(false); setNewRoleOpen(false); setResetUser(null); setResetPassword(""); };

  return <div className="admin-console">
    <header className="admin-console-header">
      <div><span className="eyebrow">OWNER ACCESS / TEAM CONTROL</span><h1>Access control</h1><p>Accounts, credentials, and the permissions behind every role.</p></div>
      <span className="admin-owner-badge"><Shield size={15} /> Owner only</span>
    </header>
    {error && <div className="admin-console-alert error" role="alert">{error}</div>}
    {message && <div className="admin-console-alert success" role="status"><Check size={15} /> {message}</div>}
    <div className="admin-console-stats">
      <div><UsersRound size={18} /><span>Active users</span><strong>{users.length}</strong></div>
      <div><Shield size={18} /><span>Access roles</span><strong>{roles.length}</strong></div>
      <div><KeyRound size={18} /><span>Credential policy</span><strong>Owner managed</strong></div>
    </div>
    <section className="admin-workspace">
      <div className="admin-workspace-top">
        <div className="admin-tabs" role="tablist" aria-label="Access control sections"><button type="button" role="tab" aria-selected={activeTab === "users"} className={activeTab === "users" ? "active" : ""} onClick={() => setActiveTab("users")}>Users <span>{users.length}</span></button><button type="button" role="tab" aria-selected={activeTab === "roles"} className={activeTab === "roles" ? "active" : ""} onClick={() => setActiveTab("roles")}>Roles <span>{roles.length}</span></button></div>
        {activeTab === "users" ? <button type="button" className="admin-primary-button" disabled={assignableRoles.length === 0} title={assignableRoles.length === 0 ? "Create a role before adding users" : undefined} onClick={() => setAddUserOpen(true)}><Plus size={16} /> Add user</button> : <button type="button" className="admin-primary-button" onClick={() => setNewRoleOpen(true)}><Plus size={16} /> New role</button>}
      </div>
      {loading ? <div className="admin-empty">Loading access controls...</div> : activeTab === "users" ? <>
        <div className="admin-section-intro"><div><h2>Team directory</h2><p>Change roles, set a new password, or remove access.</p></div><span>{users.length} accounts</span></div>
        <div className="admin-table-scroll"><table className="admin-users-table"><thead><tr><th>User</th><th>Role</th><th>Added (BS)</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.user_id}>
          <td><div className="admin-user-cell"><span className="admin-user-avatar">{(user.full_name?.trim() || user.email)[0]?.toUpperCase()}</span><span><strong>{user.full_name?.trim() || user.email}</strong><small>{user.email}</small></span></div></td>
          <td><select aria-label={`Role for ${user.full_name || user.email}`} value={user.role_key} disabled={busy || user.user_id === currentUserId} onChange={(event) => void assignRole(user, event.target.value)}>{roles.map((role) => <option key={role.role_key} value={role.role_key} disabled={role.role_key === "admin" && user.user_id !== currentUserId}>{role.name}</option>)}</select></td>
          <td className="admin-date">{adToBs(user.created_at.slice(0, 10))}</td>
          <td><div className="admin-row-actions"><button type="button" title="Set new password" aria-label={`Set new password for ${user.full_name || user.email}`} disabled={busy} onClick={() => { setResetUser(user); setResetPassword(""); setShowResetPassword(false); setError(""); }}><KeyRound size={16} /></button>{user.user_id !== currentUserId && <button type="button" className="danger" title="Delete user" aria-label={`Delete ${user.full_name || user.email}`} disabled={busy} onClick={() => void deleteUser(user)}><Trash2 size={16} /></button>}</div></td>
        </tr>)}</tbody></table></div>
      </> : <>
        <div className="admin-section-intro"><div><h2>Role policies</h2><p>Rename roles, adjust access, or remove unused roles. Admin stays protected.</p></div><span>{roles.length} roles</span></div>
        <div className="admin-roles-grid">{roles.map((role) => <article className="admin-role-card" key={role.role_key}>
          <div className="admin-role-card-head"><span className="admin-role-icon"><Shield size={18} /></span><div><h3>{role.name}</h3><small>{role.is_system ? "Protected owner role" : `${users.filter((user) => user.role_key === role.role_key).length} assigned users`}</small></div></div>
          {editingRole === role.role_key ? <><label className="admin-role-name-label">Role name<input required maxLength={60} value={editingName} onChange={(event) => setEditingName(event.target.value)} /></label>{permissionPicker(editingPermissions, setEditingPermissions)}<div className="admin-role-card-actions"><button type="button" className="admin-primary-button" disabled={busy || editingName.trim().length < 2} onClick={() => void saveRole(role)}>Save changes</button><button type="button" onClick={() => setEditingRole(null)}>Cancel</button></div></> : <><ul>{role.permissions.map((permission) => <li key={permission}><Check size={14} /> {descriptions[permission]}</li>)}</ul>{!role.is_system && <div className="admin-role-card-actions"><button type="button" onClick={() => { setEditingRole(role.role_key); setEditingName(role.name); setEditingPermissions(role.permissions); }}>Edit role</button><button type="button" className="danger" disabled={busy} onClick={() => void deleteRole(role)}>Delete role</button></div>}</>}
        </article>)}</div>
      </>}
    </section>

    {panelOpen && createPortal(<div className="admin-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePanel(); }}><aside className="admin-drawer" role="dialog" aria-modal="true" aria-label={addUserOpen ? "Add user" : newRoleOpen ? "New role" : "Set new password"}>
      <div className="admin-drawer-header"><div><span className="eyebrow">ACCESS CONTROL</span><h2>{addUserOpen ? "Create account" : newRoleOpen ? "Create role" : "Set new password"}</h2></div><button type="button" aria-label="Close panel" onClick={closePanel}><X size={19} /></button></div>
      {addUserOpen && <form className="admin-drawer-form" onSubmit={(event) => void createUser(event)}>
        <p className="admin-drawer-note">Set the email ID and password here. No invitation email is sent.</p>
        <div className="admin-form-section"><span>1</span><strong>Account identity</strong></div>
        <label>Email ID <input type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Full name <input value={fullName} autoComplete="off" maxLength={120} onChange={(event) => setFullName(event.target.value)} /></label>
        <div className="admin-form-section"><span>2</span><strong>Access and sign-in</strong></div>
        <label>Role <select required value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{assignableRoles.map((role) => <option key={role.role_key} value={role.role_key}>{role.name}</option>)}</select></label>
        <label>Password <span className="admin-password-input"><input required type={showPassword ? "text" : "password"} minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword((show) => !show)}>{showPassword ? "Hide" : "Show"}</button></span><small>12 to 128 characters. You will copy it after creation.</small></label>
        <button className="admin-primary-button" type="submit" disabled={busy}>{busy ? "Creating..." : "Create account"}</button>
      </form>}
      {resetUser && <form className="admin-drawer-form" onSubmit={(event) => void saveNewPassword(event)}>
        <div className="admin-target-user"><span className="admin-user-avatar">{(resetUser.full_name || resetUser.email)[0]?.toUpperCase()}</span><div><strong>{resetUser.full_name || resetUser.email}</strong><small>{resetUser.email}</small></div></div>
        <p className="admin-drawer-note">The old password cannot be viewed. This sets a replacement password.</p>
        <div className="admin-form-section"><span>1</span><strong>New sign-in details</strong></div>
        <label>New password <span className="admin-password-input"><input required type={showResetPassword ? "text" : "password"} minLength={12} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /><button type="button" onClick={() => setShowResetPassword((show) => !show)}>{showResetPassword ? "Hide" : "Show"}</button></span><small>12 to 128 characters.</small></label>
        <button type="submit" className="admin-primary-button" disabled={busy}>{busy ? "Saving..." : "Save new password"}</button>
      </form>}
      {newRoleOpen && <form className="admin-drawer-form" onSubmit={(event) => void createRole(event)}>
        <p className="admin-drawer-note">Choose a name and the exact areas this role can access.</p>
        <div className="admin-form-section"><span>1</span><strong>Role identity</strong></div>
        <label>Role name <input required maxLength={60} value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="e.g. Accountant" /></label>
        <div className="admin-form-section"><span>2</span><strong>Allowed actions</strong></div>
        <div className="admin-permission-label">Permissions</div>{permissionPicker(newPermissions, setNewPermissions)}
        <button type="submit" className="admin-primary-button" disabled={busy}>{busy ? "Creating..." : "Create role"}</button>
      </form>}
    </aside></div>, document.body)}

    {newCredential && createPortal(<div className="admin-drawer-backdrop"><section className="admin-credential-dialog" role="dialog" aria-modal="true" aria-label="New login details"><span className="admin-role-icon"><KeyRound size={20} /></span><h2>Login details are ready</h2><p>Copy these now. The password cannot be retrieved after you dismiss this window.</p><div><small>Email ID</small><code>{newCredential.email}</code></div><div><small>Password</small><code>{newCredential.password}</code></div><div className="admin-dialog-actions"><button type="button" className="admin-primary-button" onClick={() => void copyCredential()}><Copy size={16} /> Copy details</button><button type="button" onClick={() => setNewCredential(null)}>Done</button></div></section></div>, document.body)}
  </div>;
}
