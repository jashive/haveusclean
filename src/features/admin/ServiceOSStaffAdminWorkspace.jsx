import React, { useEffect, useMemo, useState } from "react";
import { deactivateStaffMember, inviteStaffMember, loadStaffDirectory } from "../../lib/serviceosStaffAdminClient.js";

const styles = {
  card: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18, marginTop: 14 },
  title: { margin: "0 0 6px", fontSize: 18 },
  text: { color: "#AEBAC9", fontSize: 14, lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 14 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #465873", background: "#0D1422", color: "#F5F8FC", borderRadius: 8, padding: "10px 11px" },
  button: { border: 0, borderRadius: 8, background: "#00D4AA", color: "#07110F", padding: "10px 14px", fontWeight: 850, cursor: "pointer" },
  secondary: { border: "1px solid #465873", borderRadius: 8, background: "transparent", color: "#F5F8FC", padding: "8px 11px", fontWeight: 700, cursor: "pointer" },
  error: { marginTop: 12, color: "#FF9C9C", fontSize: 13 },
  success: { marginTop: 12, color: "#54E5C2", fontSize: 13 },
  tableWrap: { overflowX: "auto", marginTop: 14 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#8291A6", padding: "9px 8px", borderBottom: "1px solid #344359" },
  td: { padding: "10px 8px", borderBottom: "1px solid #253247", verticalAlign: "top" },
};

export default function ServiceOSStaffAdminWorkspace() {
  const [directory, setDirectory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ displayName: "", email: "", roleCode: "office_ops", businessUnitCode: "HUC-ON" });

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setDirectory(await loadStaffDirectory());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const roles = directory?.roles || [];
  const businessUnits = directory?.businessUnits || [];
  const staff = directory?.staff || [];
  const selectedRole = useMemo(() => roles.find((role) => role.code === form.roleCode), [roles, form.roleCode]);
  const requiresBusinessUnit = form.roleCode !== "owner_admin";

  async function handleInvite(event) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await inviteStaffMember({
        ...form,
        businessUnitCode: requiresBusinessUnit ? form.businessUnitCode : "",
      });
      setMessage(`Invitation sent to ${result.email}. Canonical role provisioning is complete and awaits invite acceptance.`);
      setForm({ displayName: "", email: "", roleCode: "office_ops", businessUnitCode: "HUC-ON" });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  async function handleDeactivate(appUserId, displayName) {
    if (!window.confirm(`Deactivate ServiceOS access for ${displayName || "this staff member"}? Historical audit records will be retained.`)) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await deactivateStaffMember(appUserId);
      setMessage("Staff access deactivated. Historical records were retained.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section style={styles.card} data-serviceos-staff-admin="true">
      <h2 style={styles.title}>Staff Management</h2>
      <p style={styles.text}>Owner/Admin controlled onboarding. Invitations are sent through the server-side Supabase Auth boundary, then bound to one canonical ServiceOS role and approved business-unit scope.</p>

      <form onSubmit={handleInvite}>
        <div style={styles.grid}>
          <label><span style={styles.text}>Full name</span><input required style={styles.input} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Team member name" /></label>
          <label><span style={styles.text}>Email</span><input required type="email" style={styles.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
          <label><span style={styles.text}>Role</span><select style={styles.input} value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>{roles.map((role) => <option key={role.id} value={role.code}>{role.name}</option>)}</select></label>
          <label><span style={styles.text}>Business unit</span><select disabled={!requiresBusinessUnit} style={styles.input} value={form.businessUnitCode} onChange={(e) => setForm({ ...form, businessUnitCode: e.target.value })}>{businessUnits.map((unit) => <option key={unit.id} value={unit.code}>{unit.name} ({unit.code})</option>)}</select></label>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button disabled={working || loading || !selectedRole} style={{ ...styles.button, opacity: working ? 0.6 : 1 }} type="submit">{working ? "Working…" : "Invite team member"}</button>
          <button disabled={working} type="button" style={styles.secondary} onClick={refresh}>Refresh access list</button>
        </div>
      </form>

      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
      {message ? <div role="status" style={styles.success}>{message}</div> : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Team member</th><th style={styles.th}>Role / scope</th><th style={styles.th}>Auth</th><th style={styles.th}>Access</th><th style={styles.th}>Action</th></tr></thead>
          <tbody>
            {loading ? <tr><td style={styles.td} colSpan="5">Loading staff access…</td></tr> : null}
            {!loading && !staff.length ? <tr><td style={styles.td} colSpan="5">No canonical staff memberships found.</td></tr> : null}
            {!loading && staff.map((person) => (
              <tr key={person.id}>
                <td style={styles.td}><strong>{person.displayName || person.email}</strong><br /><span style={styles.text}>{person.email}</span></td>
                <td style={styles.td}>{person.memberships?.length ? person.memberships.map((m) => <div key={m.id}>{m.roleName} · {m.businessUnitCode || "Organization-wide"}</div>) : "No active membership"}</td>
                <td style={styles.td}>{person.authStatus}{person.lastSignInAt ? <><br /><span style={styles.text}>Last sign-in: {new Date(person.lastSignInAt).toLocaleString()}</span></> : null}</td>
                <td style={styles.td}>{person.status}</td>
                <td style={styles.td}>{person.status === "active" ? <button disabled={working} type="button" style={styles.secondary} onClick={() => handleDeactivate(person.id, person.displayName)}>Deactivate</button> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
