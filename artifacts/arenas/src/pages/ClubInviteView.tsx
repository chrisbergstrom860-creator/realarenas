import { useState } from "react";

export type InviteView = "invites" | "import" | "history";

interface InviteRow { id: number; email: string; name: string; role: string; touched: boolean; }
interface PendingRow { id: number; init: string; bg: string; c: string; name: string; email: string; role: string; rolePill: string; sentAgo: string; expiry: string; expiringSoon: boolean; resentState: "idle"|"sent"; visible: boolean; }

interface Props {
  view: InviteView;
  onNavigate: (v: string) => void;
  showToast: (msg: string) => void;
}

const DEFAULT_NOTE = "We've just set up our club on Arenas — it's where we'll track training, run our weekly leaderboard, and organise events together. Takes 2 minutes to join. See you Tuesday!";
const DEFAULT_SUBJECT = "You're invited to join Hackney Running Club on Arenas";

const INITIAL_PENDING: PendingRow[] = [
  { id:1, init:"JK", bg:"#FFF7ED", c:"#9A3412", name:"Jamie King",  email:"jamie.king@gmail.com",    role:"Member", rolePill:"member", sentAgo:"2d ago",  expiry:"12 days",  expiringSoon:false, resentState:"idle", visible:true },
  { id:2, init:"MT", bg:"#F5F3FF", c:"#5B21B6", name:"Marcus T.",   email:"m.thompson@outlook.com",  role:"Member", rolePill:"member", sentAgo:"4d ago",  expiry:"10 days",  expiringSoon:false, resentState:"idle", visible:true },
  { id:3, init:"KL", bg:"#ECFDF5", c:"#065F46", name:"Karen Lee",   email:"karenl@company.co.uk",    role:"Coach",  rolePill:"coach",  sentAgo:"6d ago",  expiry:"8 days",   expiringSoon:false, resentState:"idle", visible:true },
  { id:4, init:"DW", bg:"#E5E7EB", c:"#6B7280", name:"David W.",    email:"dwilliams@email.com",     role:"Member", rolePill:"member", sentAgo:"12d ago", expiry:"⚠ 2 days", expiringSoon:true,  resentState:"idle", visible:true },
  { id:5, init:"NP", bg:"#E5E7EB", c:"#6B7280", name:"Natasha P.",  email:"natasha.p@hotmail.com",   role:"Member", rolePill:"member", sentAgo:"12d ago", expiry:"⚠ 2 days", expiringSoon:true,  resentState:"idle", visible:true },
  { id:6, init:"BM", bg:"#E5E7EB", c:"#6B7280", name:"Ben M.",      email:"b.mitchell@work.com",     role:"Member", rolePill:"member", sentAgo:"12d ago", expiry:"⚠ 2 days", expiringSoon:true,  resentState:"idle", visible:true },
  { id:7, init:"RJ", bg:"#FEF3C7", c:"#92400E", name:"Raj J.",      email:"rjones@uni.ac.uk",         role:"Member", rolePill:"member", sentAgo:"8d ago",  expiry:"6 days",   expiringSoon:false, resentState:"idle", visible:true },
  { id:8, init:"CK", bg:"#FBEAF0", c:"#72243E", name:"Claire K.",   email:"claire.k@gmail.com",       role:"Admin",  rolePill:"admin",  sentAgo:"3d ago",  expiry:"11 days",  expiringSoon:false, resentState:"idle", visible:true },
];

const HISTORY_ROWS = [
  { init:"SL", bg:"#FEF9C3", c:"#854D0E", name:"Sofia L.",   email:"sofia@example.com",      rolePill:"coach",  sent:"Apr 2",  responded:"Apr 2 (4h)", status:"accepted", timeBar:100, timeLbl:"4 hrs" },
  { init:"YT", bg:"#FCE7F3", c:"#9D174D", name:"Yuki T.",    email:"yuki@example.com",       rolePill:"member", sent:"Apr 2",  responded:"Apr 3 (1d)", status:"accepted", timeBar:80,  timeLbl:"1 day" },
  { init:"AL", bg:"#E0F2FE", c:"#0369A1", name:"Alena L.",   email:"alena@example.com",      rolePill:"member", sent:"Apr 5",  responded:"Apr 5 (2h)", status:"accepted", timeBar:95,  timeLbl:"2 hrs" },
  { init:"PW", bg:"#ECFDF5", c:"#166534", name:"Petra W.",   email:"petra@example.com",      rolePill:"member", sent:"Apr 8",  responded:"Apr 9 (1d)", status:"accepted", timeBar:70,  timeLbl:"1 day" },
  { init:"JR", bg:"#FFF7ED", c:"#9A3412", name:"James R.",   email:"james.r@email.com",      rolePill:"member", sent:"Apr 10", responded:"Apr 12 (2d)", status:"accepted", timeBar:55,  timeLbl:"2 days" },
  { init:"PH", bg:"#E5E7EB", c:"#6B7280", name:"Phil H.",    email:"phil.h@email.com",       rolePill:"member", sent:"Mar 14", responded:"Expired",    status:"expired",  timeBar:0,   timeLbl:"No response / 14d" },
  { init:"GW", bg:"#E5E7EB", c:"#6B7280", name:"Grace W.",   email:"gwilliams@email.com",    rolePill:"member", sent:"Mar 20", responded:"Mar 21",     status:"declined", timeBar:0,   timeLbl:"Opted out" },
  { init:"JK", bg:"#FFF7ED", c:"#9A3412", name:"Jamie King", email:"jamie.king@gmail.com",   rolePill:"member", sent:"May 13", responded:"—",           status:"pending",  timeBar:0,   timeLbl:"12 days left" },
];

export default function ClubInviteView({ view, onNavigate, showToast }: Props) {
  const [rows, setRows] = useState<InviteRow[]>([
    { id:1, email:"", name:"Jamie", role:"Member", touched:false },
    { id:2, email:"", name:"Tom",   role:"Member", touched:false },
    { id:3, email:"", name:"Priya", role:"Member", touched:false },
  ]);
  const [nextId, setNextId] = useState(4);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [expiry, setExpiry] = useState("14 days (recommended)");
  const [toggleReminder, setToggleReminder] = useState(true);
  const [toggleNotify, setToggleNotify] = useState(true);
  const [toggleAutoJoin, setToggleAutoJoin] = useState(false);
  const [pending, setPending] = useState<PendingRow[]>(INITIAL_PENDING);
  const [modal, setModal] = useState<"success" | "paste" | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteRole, setPasteRole] = useState("Member");
  const [importDone, setImportDone] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const visiblePending = pending.filter(p => p.visible);
  const validRows = rows.filter(r => r.email.includes("@"));
  const recipientCount = rows.length;

  function addRow() {
    setRows(r => [...r, { id: nextId, email:"", name:"", role:"Member", touched:false }]);
    setNextId(n => n + 1);
  }

  function delRow(id: number) {
    if (rows.length <= 1) { showToast("Need at least one recipient"); return; }
    setRows(r => r.filter(row => row.id !== id));
  }

  function updateRow(id: number, field: string, value: string) {
    setRows(r => r.map(row => row.id === id
      ? { ...row, [field]: value, touched: field === "email" ? true : row.touched }
      : row));
  }

  function isInvalid(row: InviteRow) {
    return row.touched && row.email.length > 3 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email);
  }

  function handleSend() {
    if (validRows.length === 0) { showToast("Please add at least one valid email address"); return; }
    setModal("success");
  }

  function handleResend(id: number) {
    const p = pending.find(p => p.id === id);
    showToast(`Invitation resent to ${p?.name ?? "member"}`);
    setPending(prev => prev.map(p => p.id === id ? { ...p, resentState: "sent" } : p));
    setTimeout(() => setPending(prev => prev.map(p => p.id === id ? { ...p, resentState: "idle" } : p)), 3000);
  }

  function handleRevoke(id: number) {
    const p = pending.find(p => p.id === id);
    setPending(prev => prev.map(p => p.id === id ? { ...p, visible: false } : p));
    showToast(`Invite revoked for ${p?.name ?? "member"}`);
  }

  function handlePasteAdd() {
    const emails = pasteText.split(/[\n,]+/).map(e => e.trim()).filter(e => e.includes("@"));
    if (emails.length === 0) { showToast("No valid emails found"); return; }
    const newRows = emails.map((email, i) => ({ id: nextId + i, email, name:"", role: pasteRole, touched:true }));
    setRows(prev => {
      const filled = prev.filter(r => r.email !== "");
      return [...filled, ...newRows];
    });
    setNextId(n => n + emails.length);
    setModal(null);
    setPasteText("");
    showToast(`${emails.length} email${emails.length !== 1 ? "s" : ""} added to invite form`);
  }

  function simulateDrop() {
    setImportDone(true);
  }

  function importAndGo() {
    showToast("10 members added to invite form");
    onNavigate("invites");
  }

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <div className={`ci-toggle ${on ? "on" : "off"}`} onClick={onToggle}/>
  );

  const rolePillClass = (r: string) =>
    r === "coach" ? "cd-pill" : r === "admin" ? "cd-pill ci-pill-admin" : "cd-pill";
  const rolePillStyle = (r: string) =>
    r === "coach"
      ? { background: "var(--green-light)", color:"#166534", borderColor:"#86EFAC" }
      : r === "admin"
      ? { background: "var(--purple-light)", color:"#5B21B6", borderColor:"#C4B5FD" }
      : { background: "var(--gray-100)", color:"var(--gray-600)", borderColor:"var(--gray-200)" };

  /* ── CSV IMPORT VIEW ── */
  if (view === "import") {
    return (
      <div className="ci-tab">
        <div className="cd-page-hdr">
          <div><h1 className="cd-page-h1">Import from CSV 📥</h1><p className="cd-page-sub">Upload a spreadsheet and we'll pre-fill the invite form</p></div>
          <div className="cd-page-hdr-right"><button className="cd-btn cd-btn-ghost" onClick={() => onNavigate("invites")}>← Back</button></div>
        </div>
        <div className="ci-grid-2" style={{ alignItems:"start", gap:20 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div
              className={`ci-import-zone${isDragOver ? " drag-over" : ""}${importDone ? " done" : ""}`}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => { e.preventDefault(); setIsDragOver(false); simulateDrop(); }}
              onClick={simulateDrop}
            >
              <div style={{ fontSize:32, marginBottom:10 }}>{importDone ? "✓" : "📁"}</div>
              <div style={{ fontSize:14, fontWeight:600, color: importDone ? "#166534" : "var(--gray-900)", marginBottom:4 }}>
                {importDone ? "members.csv uploaded successfully" : "Drop your CSV file here"}
              </div>
              <div style={{ fontSize:12, color: importDone ? "#166534" : "var(--gray-500)", marginBottom:12 }}>
                {importDone ? "10 rows detected · 10 valid emails · 0 duplicates" : "or click to browse · .csv or .xlsx · max 500 rows"}
              </div>
              {!importDone && <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={e => { e.stopPropagation(); simulateDrop(); }}>Choose file</button>}
              {importDone && (
                <div style={{ marginTop:14, textAlign:"left", border:"var(--border)", borderRadius:"var(--radius)", overflow:"hidden" }}>
                  <div className="ci-csv-hdr"><span>email</span><span>first_name</span><span>role</span></div>
                  {[["jamie.king@gmail.com","Jamie","member"],["m.thompson@outlook.com","Marcus","member"],["karenl@company.co.uk","Karen","coach"],["dwilliams@email.com","David","member"]].map(([e,n,r]) => (
                    <div key={e} className="ci-csv-row"><span>{e}</span><span>{n}</span><span>{r}</span></div>
                  ))}
                  <div className="ci-csv-row" style={{ color:"var(--gray-400)", fontSize:10, textAlign:"center", justifyContent:"center" }}>+ 6 more rows</div>
                </div>
              )}
            </div>

            <div className="cd-card">
              <div className="cd-card-hdr"><div style={{ display:"flex", alignItems:"center", gap:8 }}><span className="cd-card-title">Expected CSV format</span></div></div>
              <div style={{ padding:"14px 16px" }}>
                <div style={{ border:"var(--border)", borderRadius:"var(--radius)", overflow:"hidden", marginBottom:10 }}>
                  <div className="ci-csv-hdr"><span>email</span><span>first_name</span><span>role</span></div>
                  <div className="ci-csv-row"><span>jamie@email.com</span><span>Jamie</span><span>member</span></div>
                  <div className="ci-csv-row"><span>rachel@email.com</span><span>Rachel</span><span>coach</span></div>
                </div>
                <div style={{ fontSize:12, color:"var(--gray-500)", lineHeight:1.6 }}>Only <code style={{ fontFamily:"var(--mono)", background:"var(--gray-100)", padding:"1px 5px", borderRadius:4 }}>email</code> is required. Roles: member, coach, admin (defaults to member).</div>
                <button className="cd-btn cd-btn-ghost" style={{ width:"100%", justifyContent:"center", marginTop:10 }} onClick={() => showToast("Downloading example.csv…")}>📥 Download template</button>
              </div>
            </div>

            <div className="cd-card">
              <div className="cd-card-hdr"><span className="cd-card-title">Other import options</span></div>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:7 }}>
                <button className="cd-btn cd-btn-ghost" style={{ width:"100%", justifyContent:"center" }} onClick={() => showToast("Opening Google Contacts…")}>📇 Import from Google Contacts</button>
                <button className="cd-btn cd-btn-ghost" style={{ width:"100%", justifyContent:"center" }} onClick={() => showToast("Opening Strava club import…")}>🔶 Import from Strava club</button>
                <button className="cd-btn cd-btn-ghost" style={{ width:"100%", justifyContent:"center" }} onClick={() => setModal("paste")}>📋 Paste a list of emails</button>
              </div>
            </div>
          </div>

          {importDone && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div className="cd-card">
                <div className="cd-card-hdr">
                  <span className="cd-card-title">✓ 10 members detected</span>
                  <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setImportDone(false)}>Re-upload</button>
                </div>
                <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                    <div style={{ background:"var(--green-light)", border:"1px solid #86EFAC", borderRadius:"var(--radius)", padding:10, textAlign:"center" }}><div style={{ fontSize:18, fontWeight:700, color:"#166534", fontFamily:"var(--mono)" }}>10</div><div style={{ fontSize:11, color:"#166534" }}>Valid emails</div></div>
                    <div style={{ background:"var(--gray-50)", border:"var(--border)", borderRadius:"var(--radius)", padding:10, textAlign:"center" }}><div style={{ fontSize:18, fontWeight:700, color:"var(--gray-900)", fontFamily:"var(--mono)" }}>8</div><div style={{ fontSize:11, color:"var(--gray-500)" }}>With names</div></div>
                    <div style={{ background:"var(--gray-50)", border:"var(--border)", borderRadius:"var(--radius)", padding:10, textAlign:"center" }}><div style={{ fontSize:18, fontWeight:700, color:"var(--gray-900)", fontFamily:"var(--mono)" }}>0</div><div style={{ fontSize:11, color:"var(--gray-500)" }}>Duplicates</div></div>
                  </div>
                  <div style={{ fontSize:12, color:"#7a5c00", background:"var(--yellow-light)", border:"1px solid #fde68a", borderRadius:"var(--radius)", padding:"10px 12px" }}>✦ All 10 emails are valid — no duplicates with existing members found.</div>
                  <button className="cd-btn cd-btn-yellow" style={{ width:"100%", justifyContent:"center" }} onClick={importAndGo}>Import 10 members to invite form →</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Paste modal reuse */}
        {modal === "paste" && (
          <div className="ci-modal-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("ci-modal-overlay")) setModal(null); }}>
            <div className="ci-modal">
              <div className="ci-modal-hdr"><div><div className="ci-modal-title">Paste email list</div><div className="ci-modal-sub">One email per line or comma-separated</div></div><button className="ci-modal-close" onClick={() => setModal(null)}>✕</button></div>
              <div className="ci-modal-body">
                <div className="ci-form-field"><label className="ci-form-label">Paste emails</label><textarea className="ci-form-textarea" style={{ fontFamily:"var(--mono)", fontSize:12 }} placeholder={"jamie.king@gmail.com\nm.thompson@outlook.com"} value={pasteText} onChange={e => setPasteText(e.target.value)}/></div>
                <div className="ci-form-field"><label className="ci-form-label">Default role</label><select className="ci-form-select" value={pasteRole} onChange={e => setPasteRole(e.target.value)}><option>Member</option><option>Coach</option><option>Admin</option></select></div>
              </div>
              <div className="ci-modal-footer"><button className="cd-btn cd-btn-primary" style={{ flex:1, justifyContent:"center" }} onClick={handlePasteAdd}>Add to invite form →</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── HISTORY VIEW ── */
  if (view === "history") {
    return (
      <div className="ci-tab">
        <div className="cd-page-hdr">
          <div><h1 className="cd-page-h1">Invite history 📋</h1><p className="cd-page-sub">All invitations sent from Hackney Running Club</p></div>
          <div className="cd-page-hdr-right">
            <button className="cd-btn cd-btn-ghost" onClick={() => onNavigate("invites")}>← Invites</button>
            <button className="cd-btn cd-btn-ghost" onClick={() => showToast("Exporting CSV…")}>📥 Export</button>
          </div>
        </div>
        <div className="cd-grid-4" style={{ marginBottom:16 }}>
          {[{label:"Total sent",val:"62",delta:"All time",dc:"neutral"},{label:"Accepted",val:"48",delta:"78% rate",dc:"up"},{label:"Pending",val:"8",delta:"3 expire soon",dc:"warn"},{label:"Declined/expired",val:"6",delta:"10%",dc:"neutral"}].map(s => (
            <div key={s.label} className="cd-stat-card">
              <div className="cd-sc-label">{s.label}</div>
              <div className="cd-sc-value">{s.val}</div>
              <div className={`cd-sc-delta ${s.dc === "up" ? "up" : s.dc === "warn" ? "" : ""}`} style={{ color: s.dc === "up" ? "var(--green)" : s.dc === "warn" ? "var(--orange)" : "var(--gray-400)" }}>{s.delta}</div>
            </div>
          ))}
        </div>
        <div className="cd-card">
          <table className="ci-hist-table">
            <thead><tr><th>Member</th><th>Role</th><th>Sent</th><th>Responded</th><th>Status</th><th>Time to accept</th></tr></thead>
            <tbody>
              {HISTORY_ROWS.map(r => (
                <tr key={r.email}>
                  <td><div className="ci-member-cell"><div className="cd-member-av" style={{ background:r.bg, color:r.c }}>{r.init}</div><div><div className="ci-member-name">{r.name}</div><div className="ci-member-email">{r.email}</div></div></div></td>
                  <td><span className="cd-pill" style={rolePillStyle(r.rolePill)}>{r.rolePill === "coach" ? "Coach" : r.rolePill === "admin" ? "Admin" : "Member"}</span></td>
                  <td className="ci-time-ago">{r.sent}</td>
                  <td className="ci-time-ago">{r.responded}</td>
                  <td>
                    {r.status === "accepted" && <span className="cd-pill" style={{ background:"var(--green-light)", color:"#166534", borderColor:"#86EFAC" }}>✓ Accepted</span>}
                    {r.status === "pending"  && <span className="cd-pill cd-pill-pending">⏳ Pending</span>}
                    {r.status === "expired"  && <span className="cd-pill" style={{ background:"var(--gray-100)", color:"var(--gray-500)", borderColor:"var(--gray-200)" }}>Expired</span>}
                    {r.status === "declined" && <span className="cd-pill cd-pill-risk" style={{ background:"var(--red-light)", color:"#A32D2D", borderColor:"#FECACA" }}>Declined</span>}
                  </td>
                  <td>
                    {r.timeBar > 0 && <><div className="ci-prog-mini"><div className="ci-prog-mini-fill" style={{ width:`${r.timeBar}%` }}/></div><div style={{ fontSize:10, color:"var(--gray-400)", marginTop:2 }}>{r.timeLbl}</div></>}
                    {r.timeBar === 0 && <div style={{ fontSize:10, color: r.status === "pending" ? "var(--orange)" : "var(--gray-400)" }}>{r.timeLbl}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:"10px 14px", borderTop:"var(--border)", background:"var(--gray-50)", fontSize:12, color:"var(--gray-500)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>Showing 8 of 62 invitations</span>
            <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast("Loading all…")}>Load all</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── MAIN INVITE / COMPOSE VIEW ── */
  return (
    <div className="ci-tab">
      <div className="cd-page-hdr">
        <div><h1 className="cd-page-h1">Invite members ✉️</h1><p className="cd-page-sub">Personalised email invites — members click to auto-join Hackney Running Club</p></div>
        <div className="cd-page-hdr-right">
          <button className="cd-btn cd-btn-ghost" onClick={() => onNavigate("history")}>📋 History</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="cd-grid-4" style={{ marginBottom:20 }}>
        <div className="cd-stat-card"><div className="cd-sc-label">Members</div><div className="cd-sc-value">48</div><div className="cd-sc-delta" style={{ color:"var(--gray-400)" }}>of 100 seats</div></div>
        <div className="cd-stat-card"><div className="cd-sc-label">Pending</div><div className="cd-sc-value">{visiblePending.length}</div><div className="cd-sc-delta" style={{ color:"var(--orange)" }}>3 expire soon</div></div>
        <div className="cd-stat-card"><div className="cd-sc-label">Acceptance rate</div><div className="cd-sc-value">78%</div><div className="cd-sc-delta up">↑ +4% this month</div></div>
        <div className="cd-stat-card"><div className="cd-sc-label">Seats left</div><div className="cd-sc-value">52</div><div className="cd-sc-delta" style={{ color:"var(--gray-400)" }}>Upgrade for more</div></div>
      </div>

      {/* 2-col layout */}
      <div className="ci-grid-2" style={{ alignItems:"start", gap:20 }}>

        {/* LEFT: 3-step compose */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* Step 1: Addresses */}
          <div className="cd-card">
            <div className="cd-card-hdr">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div className="ci-step-num">1</div>
                <span className="cd-card-title">Add email addresses</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => onNavigate("import")}>📥 Import CSV</button>
                <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setModal("paste")}>📋 Paste list</button>
              </div>
            </div>
            <div style={{ padding:16 }}>
              <div style={{ overflow:"hidden", border:"var(--border)", borderRadius:"var(--radius)" }}>
                <table className="ci-inv-table">
                  <thead><tr>
                    <th style={{ width:"42%" }}>Email address</th>
                    <th style={{ width:"24%" }}>First name <span style={{ fontWeight:400, color:"var(--gray-400)" }}>(opt)</span></th>
                    <th style={{ width:"22%" }}>Role</th>
                    <th style={{ width:"12%" }}></th>
                  </tr></thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.id}>
                        <td><input className={`ci-inv-input${isInvalid(row) ? " invalid" : ""}`} type="email" placeholder="name@example.com" value={row.email} onChange={e => updateRow(row.id, "email", e.target.value)}/></td>
                        <td><input className="ci-inv-input" type="text" placeholder="Name" value={row.name} onChange={e => updateRow(row.id, "name", e.target.value)}/></td>
                        <td>
                          <select className="ci-inv-select" value={row.role} onChange={e => updateRow(row.id, "role", e.target.value)}>
                            <option>Member</option><option>Coach</option><option>Admin</option>
                          </select>
                        </td>
                        <td style={{ textAlign:"center" }}>
                          <button className="ci-inv-del" onClick={() => delRow(row.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ci-add-row" onClick={addRow}>+ Add another email</div>
              </div>
              <div style={{ fontSize:12, color:"var(--gray-400)", marginTop:8, display:"flex", justifyContent:"space-between" }}>
                <span>52 seats remaining on Club Pro</span>
                <span>{recipientCount} recipient{recipientCount !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>

          {/* Step 2: Personalise */}
          <div className="cd-card">
            <div className="cd-card-hdr">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div className="ci-step-num">2</div>
                <span className="cd-card-title">Personalise the email <span style={{ fontWeight:400, color:"var(--gray-500)", fontSize:12 }}>(optional)</span></span>
              </div>
              <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => { setSubject(DEFAULT_SUBJECT); setNote(DEFAULT_NOTE); }}>Reset</button>
            </div>
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
              <div className="ci-form-field">
                <label className="ci-form-label">Email subject</label>
                <input className="ci-form-input" type="text" value={subject} onChange={e => setSubject(e.target.value)}/>
              </div>
              <div className="ci-form-field">
                <label className="ci-form-label">Your personal note <span style={{ fontWeight:400, color:"var(--gray-400)" }}>shown in the email body</span></label>
                <textarea className="ci-form-textarea" value={note} onChange={e => setNote(e.target.value)} style={{ minHeight:88 }}/>
                <div style={{ fontSize:11, color: note.length > 450 ? "var(--orange)" : "var(--gray-400)", textAlign:"right", marginTop:2 }}>{note.length} / 500 characters</div>
              </div>
              <div className="ci-form-field">
                <label className="ci-form-label">Invite expires after</label>
                <select className="ci-form-select" value={expiry} onChange={e => setExpiry(e.target.value)}>
                  <option>7 days</option><option>14 days (recommended)</option><option>30 days</option><option>Never expires</option>
                </select>
                <div style={{ fontSize:11, color:"var(--gray-400)", marginTop:2 }}>Non-responders get one automatic reminder 2 days before expiry</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"12px 14px", background:"var(--gray-50)", borderRadius:"var(--radius)" }}>
                <div className="ci-toggle-wrap"><Toggle on={toggleReminder} onToggle={() => setToggleReminder(v => !v)}/><span>Send automatic reminder to non-responders on day 5</span></div>
                <div className="ci-toggle-wrap"><Toggle on={toggleNotify} onToggle={() => setToggleNotify(v => !v)}/><span>Notify me when each invite is accepted</span></div>
                <div className="ci-toggle-wrap"><Toggle on={toggleAutoJoin} onToggle={() => setToggleAutoJoin(v => !v)}/><span>Auto-join without approval (not recommended)</span></div>
              </div>
            </div>
          </div>

          {/* Step 3: Send */}
          <div className="cd-card">
            <div className="cd-card-hdr">
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div className="ci-step-num">3</div>
                <span className="cd-card-title">Review and send</span>
              </div>
            </div>
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ background:"var(--gray-50)", border:"var(--border)", borderRadius:"var(--radius)", padding:"12px 14px", fontSize:13, color:"var(--gray-700)", display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Recipients</span><strong style={{ color:"var(--gray-900)" }}>{recipientCount} email invite{recipientCount !== 1 ? "s" : ""}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Invite window</span><strong style={{ color:"var(--gray-900)" }}>{expiry.split(" ")[0]} {expiry.includes("Never") ? "— never expires" : "days"}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Auto-reminder</span><strong style={{ color:"var(--gray-900)" }}>{toggleReminder ? "Day 5" : "Off"}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>Seats after sending</span><strong style={{ color:"var(--gray-900)" }}>{52 - recipientCount} remaining</strong></div>
              </div>
              <button className="cd-btn cd-btn-yellow" style={{ width:"100%", justifyContent:"center", padding:12, fontSize:14 }} onClick={handleSend}>
                ✉️ Send {recipientCount} invitation{recipientCount !== 1 ? "s" : ""} now
              </button>
              <div style={{ fontSize:12, color:"var(--gray-400)", textAlign:"center" }}>Sent from <strong style={{ color:"var(--gray-600)" }}>clubs@arenas.io</strong> on behalf of Hackney RC · Rachel H.</div>
            </div>
          </div>
        </div>

        {/* RIGHT: Live email preview */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
            <div style={{ fontSize:13, fontWeight:600, color:"var(--gray-900)" }}>Live email preview</div>
            <div style={{ fontSize:11, color:"var(--gray-400)" }}>Updates as you type ↑</div>
          </div>
          <div className="cd-card" style={{ overflow:"hidden" }}>
            {/* Chrome bar */}
            <div className="ci-ep-chrome">
              <div className="ci-ep-dots">
                <div className="ci-ep-dot" style={{ background:"#EF4444" }}/>
                <div className="ci-ep-dot" style={{ background:"#F59E0B" }}/>
                <div className="ci-ep-dot" style={{ background:"#10B981" }}/>
              </div>
              <div className="ci-ep-url">clubs@arenas.io — on behalf of Rachel H.</div>
            </div>
            {/* Header */}
            <div className="ci-ep-header">
              <div className="ci-ep-field"><span className="ci-ep-lbl">From:</span><span className="ci-ep-val">Arenas Clubs &lt;clubs@arenas.io&gt; on behalf of Rachel H.</span></div>
              <div className="ci-ep-field"><span className="ci-ep-lbl">To:</span><span className="ci-ep-val">{rows[0]?.name ? `${rows[0].name.toLowerCase()}@example.com` : "jamie@example.com"}</span></div>
              <div className="ci-ep-field"><span className="ci-ep-lbl">Subject:</span><span className="ci-ep-val" style={{ fontWeight:500 }}>{subject || "(no subject)"}</span></div>
            </div>
            {/* Body */}
            <div className="ci-ep-body">
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
                <div style={{ width:34, height:34, borderRadius:8, background:"var(--orange-light)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>🏃</div>
                <div><div style={{ fontSize:13, fontWeight:600, color:"var(--gray-900)" }}>Hackney Running Club</div><div style={{ fontSize:11, color:"var(--gray-500)" }}>London · 48 members</div></div>
                <div style={{ marginLeft:"auto", width:24, height:24, background:"var(--yellow)", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>🏟</div>
              </div>
              <div className="ci-ep-h1">You've been invited to join Hackney Running Club</div>
              <div className="ci-ep-p">Hi {rows[0]?.name || "Jamie"}, your coach <strong>Rachel H.</strong> has personally invited you to join <strong>Hackney Running Club</strong> on Arenas — the platform your club uses to track training, compete on private leaderboards, and manage events together.</div>
              <div className="ci-ep-quote">{note || "(no personal note)"}</div>
              <div className="ci-ep-club-card">
                <div className="ci-ep-club-name">🏃 Hackney Running Club</div>
                <div className="ci-ep-club-meta"><span>📍 London, UK</span><span>👥 48 members</span><span>🏅 Running</span><span>⚡ Est. 2018</span></div>
              </div>
              <div style={{ fontSize:13, color:"var(--gray-700)", marginBottom:10, lineHeight:1.6 }}>When you accept, you'll get instant access to:</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:16 }}>
                {["Private club leaderboard and weekly rankings","AI coaching on every activity you log","Club challenges and event sign-ups","Club activity feed — follow your teammates"].map(f => (
                  <div key={f} style={{ fontSize:13, color:"var(--gray-700)", display:"flex", gap:8 }}><span style={{ color:"var(--green)", fontWeight:700, flexShrink:0 }}>✓</span>{f}</div>
                ))}
              </div>
              <button className="ci-ep-btn-primary" onClick={() => showToast("This would open the member signup page")}>✓ Accept invite &amp; create free account →</button>
              <button className="ci-ep-btn-secondary" onClick={() => showToast("This would sign in to existing account")}>Already have an Arenas account? Sign in instead</button>
              <div className="ci-ep-link-fallback">Or copy: arenas.io/invite/hrc-{rows[0]?.name?.toLowerCase() || "jamie"}-x7k2p9</div>
              <div className="ci-ep-divider"/>
              <div className="ci-ep-footer">Sent by <strong>Rachel H.</strong> · Hackney Running Club · Expires in {expiry.split(" ")[0]} days<br/><a href="#" onClick={e => e.preventDefault()}>Unsubscribe</a> · <a href="#" onClick={e => e.preventDefault()}>Privacy policy</a></div>
            </div>
          </div>

          {/* What happens next */}
          <div className="cd-card">
            <div className="cd-card-hdr"><span className="cd-card-title">What happens after you send</span></div>
            {[
              { n:"1", active:true,  title:"Email arrives instantly",  sub:"Delivered from clubs@arenas.io typically within 30 seconds. Unique one-time link per recipient." },
              { n:"2", active:false, title:"Member clicks Accept",      sub:"Lands on club-branded signup page. Creates new Arenas account or links existing one — 90 seconds." },
              { n:"3", active:false, title:"Auto-joined immediately",   sub:"No approval needed. Member appears in your dashboard instantly. You receive a notification." },
              { n:"4", active:false, title:"Auto-reminder on day 5",    sub:"If they haven't responded, Arenas sends one gentle reminder automatically. No action needed from you." },
            ].map((step, i) => (
              <div key={i} style={{ display:"flex", gap:12, padding:"12px 16px", borderBottom: i < 3 ? "var(--border)" : "none" }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background: step.active ? "var(--yellow)" : "var(--gray-100)", color: step.active ? "var(--gray-900)" : "var(--gray-600)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0, marginTop:1 }}>{step.n}</div>
                <div><div style={{ fontSize:13, fontWeight:600, color:"var(--gray-900)" }}>{step.title}</div><div style={{ fontSize:12, color:"var(--gray-500)", marginTop:2 }}>{step.sub}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pending invites table */}
      <div style={{ marginTop:24 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:"var(--gray-900)" }}>
              Pending invitations <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:400, color:"var(--gray-500)", marginLeft:6 }}>{visiblePending.length} awaiting response</span>
            </div>
            <div style={{ fontSize:12, color:"var(--gray-500)", marginTop:2 }}>3 expire within 48 hours — highlighted below</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => showToast(`Reminder sent to all ${visiblePending.length} pending members`)}>📢 Nudge all</button>
            <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => showToast("Expired invites cleared")}>🗑 Clear expired</button>
          </div>
        </div>
        <div className="cd-card">
          <table className="ci-pending-table">
            <thead><tr><th>Invited member</th><th>Role</th><th>Sent</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {pending.filter(p => p.visible).map(p => (
                <tr key={p.id} style={ p.expiringSoon ? { background:"#FFF5F5" } : {}}>
                  <td>
                    <div className="ci-member-cell">
                      <div className="cd-member-av" style={{ background:p.bg, color:p.c }}>{p.init}</div>
                      <div><div className="ci-member-name">{p.name}</div><div className="ci-member-email">{p.email}</div></div>
                    </div>
                  </td>
                  <td><span className="cd-pill" style={rolePillStyle(p.rolePill)}>{p.role}</span></td>
                  <td className="ci-time-ago">{p.sentAgo}</td>
                  <td className="ci-time-ago" style={ p.expiringSoon ? { color:"var(--red)", fontWeight:600 } : { color:"var(--gray-500)" } }>{p.expiry}</td>
                  <td><span className="cd-pill cd-pill-pending">⏳ Pending</span></td>
                  <td>
                    <div style={{ display:"flex", gap:5 }}>
                      <button
                        className={`cd-btn cd-btn-sm ${p.resentState === "sent" ? "ci-btn-resent" : p.expiringSoon ? "cd-btn-yellow" : "cd-btn-ghost"}`}
                        onClick={() => p.resentState === "idle" && handleResend(p.id)}
                        disabled={p.resentState === "sent"}
                      >
                        {p.resentState === "sent" ? "✓ Resent" : p.expiringSoon ? "↩ Resend now" : "↩ Resend"}
                      </button>
                      <button className="cd-btn cd-btn-sm ci-btn-red" onClick={() => handleRevoke(p.id)}>✕ Revoke</button>
                    </div>
                  </td>
                </tr>
              ))}
              {visiblePending.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign:"center", padding:24, color:"var(--gray-400)", fontSize:13 }}>No pending invites — all cleared!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MODALS ── */}

      {/* Paste list */}
      {modal === "paste" && (
        <div className="ci-modal-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("ci-modal-overlay")) setModal(null); }}>
          <div className="ci-modal">
            <div className="ci-modal-hdr"><div><div className="ci-modal-title">Paste email list</div><div className="ci-modal-sub">One email per line or comma-separated</div></div><button className="ci-modal-close" onClick={() => setModal(null)}>✕</button></div>
            <div className="ci-modal-body">
              <div className="ci-form-field"><label className="ci-form-label">Paste emails</label><textarea className="ci-form-textarea" style={{ fontFamily:"var(--mono)", fontSize:12 }} placeholder={"jamie.king@gmail.com\nm.thompson@outlook.com\nkarenl@company.co.uk"} value={pasteText} onChange={e => setPasteText(e.target.value)}/></div>
              <div className="ci-form-field"><label className="ci-form-label">Default role</label><select className="ci-form-select" value={pasteRole} onChange={e => setPasteRole(e.target.value)}><option>Member</option><option>Coach</option><option>Admin</option></select></div>
            </div>
            <div className="ci-modal-footer"><button className="cd-btn cd-btn-primary" style={{ flex:1, justifyContent:"center" }} onClick={handlePasteAdd}>Add to invite form →</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* Success */}
      {modal === "success" && (
        <div className="ci-modal-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("ci-modal-overlay")) setModal(null); }}>
          <div className="ci-modal">
            <div className="ci-modal-hdr"><div><div className="ci-modal-title">Invitations sent! 🎉</div></div><button className="ci-modal-close" onClick={() => setModal(null)}>✕</button></div>
            <div className="ci-modal-body">
              <div className="ci-success-banner">
                <div className="ci-sb-icon">✓</div>
                <div>
                  <div className="ci-sb-title">{recipientCount} invitation{recipientCount !== 1 ? "s" : ""} sent successfully</div>
                  <div className="ci-sb-sub">Emails are on their way. You'll be notified when each member accepts. Arenas sends one automatic reminder on day 5 for anyone who hasn't responded.</div>
                  <div className="ci-send-summary">
                    <div className="ci-ss-item"><div className="ci-ss-val">{recipientCount}</div><div className="ci-ss-label">Emails sent</div></div>
                    <div className="ci-ss-item"><div className="ci-ss-val">{expiry.split(" ")[0]}d</div><div className="ci-ss-label">Invite window</div></div>
                    <div className="ci-ss-item"><div className="ci-ss-val">Day 5</div><div className="ci-ss-label">Auto-reminder</div></div>
                  </div>
                </div>
              </div>
              <div style={{ background:"var(--gray-50)", border:"var(--border)", borderRadius:"var(--radius)", padding:"12px 14px", fontSize:12, color:"var(--gray-600)", lineHeight:1.6, display:"flex", flexDirection:"column", gap:5 }}>
                <div>✓ Each invite has a unique one-time link — can only be used by the recipient</div>
                <div>✓ Members who already have Arenas accounts will be linked automatically</div>
                <div>✓ New members appear in your dashboard the moment they accept</div>
                <div>✓ You can resend or revoke any invite from the pending table below</div>
              </div>
            </div>
            <div className="ci-modal-footer"><button className="cd-btn cd-btn-yellow" style={{ flex:1, justifyContent:"center" }} onClick={() => setModal(null)}>View pending invites →</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
