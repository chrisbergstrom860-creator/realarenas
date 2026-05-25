import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import ClubInviteView, { type InviteView } from "./ClubInviteView";

type Tab = "overview" | "members" | "training" | "leaderboard" | "challenges" | "events" | "feed" | "reports" | "invites" | "import" | "history";
type Modal = "invite" | "event" | "event-rsvp" | "challenge" | null;

const STREAK = (pattern: string) => pattern.split("").map((c, i) =>
  <div key={i} className={`cd-s-dot${c === "1" ? " cd-s-done" : c === "t" ? " cd-s-today" : " cd-s-miss"}`}/>
);

const MEMBERS = [
  { init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  handle: "@sofialopes", status: "active",  km: "88.2",  load: 95,  loadLbl: "High · 95%",    loadC: "var(--orange)", streak: "1111111t", pts: "9,840", role: "Coach",  risk: "low" },
  { init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   handle: "@yukitri",    status: "risk",    km: "68.0",  load: 100, loadLbl: "Overload · 142%", loadC: "var(--red)",    streak: "111111t", pts: "7,610", role: "Member", risk: "high" },
  { init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  handle: "@alenal",     status: "active",  km: "71.4",  load: 82,  loadLbl: "Moderate · 82%",  loadC: "var(--blue)",   streak: "1011111t", pts: "7,220", role: "Member", risk: "low" },
  { init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  handle: "@jamiek",     status: "active",  km: "12.4",  load: 45,  loadLbl: "Easy · 45%",      loadC: "var(--green)",  streak: "1101111t", pts: "6,440", role: "Member", risk: "low" },
  { init: "TR", bg: "#F5F3FF", c: "#5B21B6", name: "Tom R.",    handle: "@tomr",       status: "rest",    km: "0.0",   load: 0,   loadLbl: "Rest week",         loadC: "var(--gray-300)", streak: "1110000t", pts: "4,120", role: "Member", risk: "med" },
  { init: "PW", bg: "#ECFDF5", c: "#166534", name: "Petra W.", handle: "@petraw",     status: "active",  km: "54.2",  load: 68,  loadLbl: "Moderate · 68%",   loadC: "var(--teal)",   streak: "1111101t", pts: "5,880", role: "Member", risk: "low" },
];

const LB_ROWS = [
  { rank: 1, init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  detail: "88.2 km this week", score: "9,840", trend: "↑+1", trendC: "lt-up",  you: false },
  { rank: 2, init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   detail: "68.0 km this week", score: "7,610", trend: "↑+2", trendC: "lt-up",  you: false },
  { rank: 3, init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  detail: "71.4 km this week", score: "7,220", trend: "—",   trendC: "lt-eq",  you: false },
  { rank: 4, init: "PW", bg: "#ECFDF5", c: "#166534", name: "Petra W.",  detail: "54.2 km this week", score: "5,880", trend: "↑+1", trendC: "lt-up",  you: false },
  { rank: 5, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  detail: "12.4 km this week", score: "6,440", trend: "↑+3", trendC: "lt-up",  you: true  },
  { rank: 6, init: "TR", bg: "#F5F3FF", c: "#5B21B6", name: "Tom R.",    detail: "0.0 km this week",  score: "4,120", trend: "↓−2", trendC: "lt-dn",  you: false },
];

export default function ClubDashboard() {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  const filteredMembers = MEMBERS.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.handle.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="cd-app">

      {/* ── TOPBAR ── */}
      <header className="cd-topbar">
        <div className="cd-topbar-logo">
          <div className="cd-logo-icon" onClick={() => setLocation("/")} style={{ cursor: "pointer" }}>🏟</div>
          <span className="cd-logo-text" onClick={() => setLocation("/")} style={{ cursor: "pointer" }}>Arenas</span>
          <span className="cd-club-badge">Club Pro</span>
        </div>
        <div className="cd-topbar-center">
          <div className="cd-topbar-search">
            <span style={{ color: "var(--gray-400)", fontSize: 13 }}>🔍</span>
            <input type="text" placeholder="Search members, events, challenges…"/>
          </div>
          <span className="cd-topbar-club-name">Hackney Running Club</span>
          <span className="cd-topbar-role">Coach · Admin</span>
        </div>
        <div className="cd-topbar-actions">
          <div className="cd-notif-btn" onClick={() => showToast("3 new notifications")}>
            🔔<div className="cd-notif-dot"/>
          </div>
          <div className="cd-user-av" onClick={() => { logout(); setLocation("/"); }}>RH</div>
        </div>
      </header>

      {/* ── SIDEBAR ── */}
      <aside className="cd-sidebar">
        <div className="cd-nav-label">Club management</div>
        {([
          ["overview",    "📊", "Overview",       ""],
          ["invites",     "✉️", "Invite members",  "8"],
          ["members",     "👥", "Members",         "48"],
          ["training",    "📈", "Training load",   "3"],
          ["leaderboard", "🏆", "Leaderboard",     ""],
          ["challenges",  "⚡", "Challenges",       "4"],
          ["events",      "📅", "Events",           "3"],
        ] as [Tab, string, string, string][]).map(([id, icon, label, badge]) => (
          <div key={id} className={`cd-nav-item${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            <span className="cd-nav-icon">{icon}</span> {label}
            {badge && <span className={`cd-nav-badge${id === "training" ? " alert" : id === "invites" ? " alert" : ""}`}>{badge}</span>}
          </div>
        ))}
        <div className="cd-nav-label">Analytics</div>
        {([
          ["feed",    "🏃", "Club feed",       ""],
          ["history", "📋", "Invite history",  ""],
          ["reports", "📋", "Reports",         ""],
        ] as [Tab, string, string, string][]).map(([id, icon, label]) => (
          <div key={id} className={`cd-nav-item${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            <span className="cd-nav-icon">{icon}</span> {label}
          </div>
        ))}
        <div className="cd-nav-label">Settings</div>
        <div className="cd-nav-item" onClick={() => showToast("Opening club settings…")}><span className="cd-nav-icon">⚙️</span> Club settings</div>
        <div className="cd-nav-item" onClick={() => showToast("Opening billing…")}><span className="cd-nav-icon">💳</span> Billing</div>
        <div className="cd-sidebar-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="cd-club-icon">🏃</div>
            <div><div className="cd-club-name-small">Hackney RC</div><div className="cd-club-plan">Club Pro · 48 / 100 members</div></div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="cd-main">

        {/* ══ OVERVIEW ══ */}
        {tab === "overview" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Good morning, Rachel 👋</h1><p className="cd-page-sub">Hackney Running Club · Week of May 15–22, 2026 · 48 members</p></div>
              <div className="cd-page-hdr-right">
                <button className="cd-btn cd-btn-ghost" onClick={() => showToast("Generating weekly report PDF…")}>📋 Export report</button>
                <button className="cd-btn cd-btn-yellow" onClick={() => setModal("event")}>+ New event</button>
              </div>
            </div>

            {/* Pending invites banner */}
            <div className="ci-pending-banner" onClick={() => setTab("invites")}>
              <div style={{ fontSize: 22 }}>✉️</div>
              <div style={{ flex: 1 }}>
                <div className="ci-pb-title">8 pending invitations waiting</div>
                <div className="ci-pb-sub">3 members expire in 2 days — resend now to avoid losing them.</div>
              </div>
              <button className="cd-btn cd-btn-yellow cd-btn-sm" onClick={e => { e.stopPropagation(); setTab("invites"); }}>View pending →</button>
            </div>

            {/* Risk alert */}
            <div className="cd-risk-card" style={{ marginBottom: 16 }}>
              <div className="cd-risk-icon">⚠️</div>
              <div className="cd-risk-content">
                <div className="cd-risk-name">Yuki T. — overtraining risk</div>
                <div className="cd-risk-desc">Training load spiked 42% above their 4-week average this week (68km vs 48km norm). Heart rate also elevated in last 3 sessions. Recommend rest day before Saturday's long run.</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="cd-btn cd-btn-sm cd-btn-primary" onClick={() => showToast("Message sent to Yuki T.")}>Message member</button>
                  <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast("Dismissed for this week")}>Dismiss</button>
                </div>
              </div>
            </div>

            {/* Stat cards */}
            <div className="cd-grid-4" style={{ marginBottom: 16 }}>
              {[
                { label: "Active members",       value: "39",  delta: "↑ +4 vs last week",  up: true,  pct: 81,  color: "var(--green)" },
                { label: "Total km this week",   value: "312", delta: "↑ +48km vs last week", up: true,  pct: 72,  color: "var(--orange)" },
                { label: "Challenge completion", value: "89%", delta: "↑ +12% vs last week",  up: true,  pct: 89,  color: "var(--purple)" },
                { label: "Injury risk flags",    value: "3",   delta: "↑ +1 vs last week",   up: false, pct: 30,  color: "var(--red)" },
              ].map(s => (
                <div key={s.label} className="cd-stat-card">
                  <div className="cd-sc-label">{s.label}</div>
                  <div className="cd-sc-value">{s.value}</div>
                  <div className={`cd-sc-delta ${s.up ? "up" : "dn"}`}>{s.delta}</div>
                  <div className="cd-sc-bar"><div className="cd-sc-bar-fill" style={{ width: `${s.pct}%`, background: s.color }}/></div>
                </div>
              ))}
            </div>

            {/* 3-col bottom */}
            <div className="cd-grid-3">
              {/* Top performers */}
              <div className="cd-card">
                <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>🏆</span><span className="cd-card-title">Top performers this week</span></div><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setTab("leaderboard")}>Full board →</button></div>
                <div style={{ padding: "6px 0" }}>
                  {LB_ROWS.slice(0,4).map(r => (
                    <div key={r.rank} className={`cd-lb-row${r.you ? " is-you" : ""}`}>
                      <div className={`cd-lb-rank${r.rank === 1 ? " r1" : r.rank === 2 ? " r2" : r.rank === 3 ? " r3" : ""}`}>{r.rank}</div>
                      <div className="cd-lb-athlete"><div className="cd-lb-av" style={{ background: r.bg, color: r.c }}>{r.init}</div><div><div className="cd-lb-name">{r.name}</div><div className="cd-lb-detail">{r.detail}</div></div></div>
                      <div className="cd-lb-score-cell"><div className="cd-lb-score">{r.score}</div><div className="cd-lb-score-sub">pts</div></div>
                      <div><span className={`cd-lb-trend ${r.trendC}`}>{r.trend}</span></div>
                      <div>{r.you && <span className="cd-you-tag">you</span>}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upcoming events */}
              <div className="cd-card">
                <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>📅</span><span className="cd-card-title">Upcoming events</span></div><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setTab("events")}>All events →</button></div>
                {[
                  { day: "13", mon: "Apr", name: "London Half Marathon",    detail: "34 going · 8 pending · 6 declined" },
                  { day: "19", mon: "Apr", name: "Parkrun Club Takeover",   detail: "22 going · 14 pending" },
                ].map(ev => (
                  <div key={ev.name} className="cd-feed-item">
                    <div className="cd-ev-date-box" style={{ width: 40, height: 40, borderRadius: 7, flexShrink: 0 }}><div className="cd-ed" style={{ fontSize: 15 }}>{ev.day}</div><div className="cd-em">{ev.mon}</div></div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>{ev.name}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{ev.detail}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <button className="cd-btn cd-btn-sm cd-btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setModal("event-rsvp")}>View RSVPs</button>
                        <button className="cd-btn cd-btn-sm cd-btn-yellow" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => showToast("Reminder sent to pending members")}>Nudge pending</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Active challenges */}
              <div className="cd-card">
                <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>⚡</span><span className="cd-card-title">Active challenges</span></div><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setTab("challenges")}>All →</button></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14 }}>
                  {[
                    { name: "100km May Run",       pct: 72, color: "var(--orange)", status: "9 days",  detail: "32 / 44 members completed" },
                    { name: "Club weekly streak",  pct: 89, color: "var(--purple)", status: "ongoing", detail: "39 / 44 members active this week" },
                    { name: "Sub-25 5K club",      pct: 38, color: "var(--blue)",   status: "always open", detail: "17 / 44 members achieved" },
                  ].map(ch => (
                    <div key={ch.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}><span style={{ fontWeight: 600, color: "var(--gray-900)" }}>{ch.name}</span><span style={{ color: "var(--gray-500)", fontFamily: "var(--mono)" }}>{ch.status}</span></div>
                      <div className="cd-prog-track"><div className="cd-prog-fill" style={{ width: `${ch.pct}%`, background: ch.color }}/></div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 3 }}>{ch.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ MEMBERS ══ */}
        {tab === "members" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Members</h1><p className="cd-page-sub">48 members · 39 active this week · 3 flagged for review</p></div>
              <div className="cd-page-hdr-right">
                <button className="cd-btn cd-btn-ghost" onClick={() => showToast("Importing CSV…")}>📥 Import CSV</button>
                <button className="cd-btn cd-btn-yellow" onClick={() => setModal("invite")}>+ Invite members</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <input type="text" placeholder="Search members…" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, outline: "none", width: 220, fontFamily: "var(--font)" }}/>
              <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer", fontFamily: "var(--font)" }}><option>All statuses</option><option>Active</option><option>At risk</option><option>Rest week</option></select>
              <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer", fontFamily: "var(--font)" }}><option>All roles</option><option>Member</option><option>Coach</option><option>Admin</option></select>
            </div>
            <div className="cd-card">
              <table className="cd-member-table">
                <thead><tr><th>Member</th><th>Status</th><th>This week</th><th>Training load</th><th>Streak (7d)</th><th>Points</th><th>Role</th><th></th></tr></thead>
                <tbody>
                  {filteredMembers.map(m => (
                    <tr key={m.name} className={m.status === "risk" ? "at-risk" : ""}>
                      <td><div className="cd-member-name-cell"><div className="cd-member-av" style={{ background: m.bg, color: m.c }}>{m.init}</div><div><div className="cd-member-name">{m.name}</div><div className="cd-member-handle">{m.handle}</div></div></div></td>
                      <td><span className={`cd-pill${m.status === "active" ? " cd-pill-active" : m.status === "risk" ? " cd-pill-risk" : " cd-pill-rest"}`}>{m.status === "active" ? "Active" : m.status === "risk" ? "⚠ At risk" : "Rest week"}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{m.km} km</td>
                      <td><div style={{ width: 90 }}><div className="cd-load-bar"><div className="cd-load-fill" style={{ width: `${Math.min(m.load, 100)}%`, background: m.loadC }}/></div><div className="cd-load-val">{m.loadLbl}</div></div></td>
                      <td><div className="cd-streak-dots">{STREAK(m.streak)}</div></td>
                      <td style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{m.pts}</td>
                      <td><span className="cd-pill cd-pill-active" style={{ fontSize: 10 }}>{m.role}</span></td>
                      <td><div style={{ display: "flex", gap: 5 }}><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast(`Opening ${m.name}'s profile…`)}>View</button><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast("Message sent")}>💬</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ TRAINING LOAD ══ */}
        {tab === "training" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Training load 📈</h1><p className="cd-page-sub">AI-powered overtraining detection across all 48 members</p></div>
              <div className="cd-page-hdr-right">
                <button className="cd-btn cd-btn-ghost" onClick={() => showToast("Exporting training report…")}>📋 Export</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {[
                { init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",  desc: "Training load spiked 42% above their 4-week average (68km vs 48km norm). HR elevated in last 3 sessions.", risk: "high" },
                { init: "TR", bg: "#F5F3FF", c: "#5B21B6", name: "Tom R.",   desc: "No activity logged in 6 days — unusual given typical 5-day/week schedule. Check in recommended.", risk: "med" },
                { init: "PW", bg: "#ECFDF5", c: "#166534", name: "Petra W.", desc: "Weekly distance increased 28% vs 4-week norm. Within acceptable range but worth monitoring.", risk: "med" },
              ].map(r => (
                <div key={r.name} className="cd-risk-card">
                  <div className="cd-risk-icon">{r.risk === "high" ? "⚠️" : "💛"}</div>
                  <div className="cd-risk-content">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div className="cd-member-av" style={{ background: r.bg, color: r.c, width: 26, height: 26, fontSize: 9 }}>{r.init}</div>
                      <span className="cd-risk-name">{r.name}</span>
                      <span className={`cd-risk-flag cd-risk-${r.risk}`}>{r.risk === "high" ? "High risk" : "Watch"}</span>
                    </div>
                    <div className="cd-risk-desc">{r.desc}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="cd-btn cd-btn-sm cd-btn-primary" onClick={() => showToast(`Message sent to ${r.name}`)}>Message member</button>
                      <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast("Dismissed")}>Dismiss</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cd-card">
              <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>📊</span><span className="cd-card-title">All members — weekly load vs norm</span></div></div>
              <table className="cd-member-table">
                <thead><tr><th>Member</th><th>This week</th><th>4-wk avg</th><th>vs norm</th><th>Load bar</th><th>Risk</th></tr></thead>
                <tbody>
                  {[
                    { ...MEMBERS[0], avg: "48.1", vsNorm: "+83%", riskLbl: "High",     riskC: "cd-risk-high" },
                    { ...MEMBERS[1], avg: "48.0", vsNorm: "+142%",riskLbl: "Overload", riskC: "cd-risk-high" },
                    { ...MEMBERS[2], avg: "57.2", vsNorm: "+25%", riskLbl: "Watch",    riskC: "cd-risk-med"  },
                    { ...MEMBERS[3], avg: "38.5", vsNorm: "−68%", riskLbl: "Taper",    riskC: "cd-risk-low"  },
                    { ...MEMBERS[4], avg: "42.0", vsNorm: "−100%",riskLbl: "Watch",    riskC: "cd-risk-med"  },
                    { ...MEMBERS[5], avg: "44.8", vsNorm: "+21%", riskLbl: "Normal",   riskC: "cd-risk-low"  },
                  ].map((m, i) => (
                    <tr key={i} className={m.risk === "high" ? "at-risk" : ""}>
                      <td><div className="cd-member-name-cell"><div className="cd-member-av" style={{ background: m.bg, color: m.c }}>{m.init}</div><div className="cd-member-name">{m.name}</div></div></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{m.km} km</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{m.avg} km</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{m.vsNorm}</td>
                      <td><div className="cd-load-bar" style={{ width: 100 }}><div className="cd-load-fill" style={{ width: `${Math.min(m.load, 100)}%`, background: m.loadC }}/></div></td>
                      <td><span className={`cd-risk-flag ${m.riskC}`}>{m.riskLbl}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ LEADERBOARD ══ */}
        {tab === "leaderboard" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Club leaderboard 🏆</h1><p className="cd-page-sub">Weekly points · resets every Monday · based on distance and activities</p></div>
              <div className="cd-page-hdr-right">
                <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", fontFamily: "var(--font)" }}><option>This week</option><option>This month</option><option>All time</option></select>
              </div>
            </div>
            <div className="cd-card">
              <div className="cd-lb-header"><div/><div>Athlete</div><div style={{ textAlign: "right" }}>Points</div><div style={{ textAlign: "right" }}>Trend</div><div/></div>
              {LB_ROWS.map(r => (
                <div key={r.rank} className={`cd-lb-row${r.you ? " is-you" : ""}`}>
                  <div className={`cd-lb-rank${r.rank === 1 ? " r1" : r.rank === 2 ? " r2" : r.rank === 3 ? " r3" : ""}`}>{r.rank}</div>
                  <div className="cd-lb-athlete"><div className="cd-lb-av" style={{ background: r.bg, color: r.c }}>{r.init}</div><div><div className="cd-lb-name">{r.name}{r.you && <span className="cd-you-tag" style={{ marginLeft: 6 }}>you</span>}</div><div className="cd-lb-detail">{r.detail}</div></div></div>
                  <div className="cd-lb-score-cell"><div className="cd-lb-score">{r.score}</div><div className="cd-lb-score-sub">pts</div></div>
                  <div><span className={`cd-lb-trend ${r.trendC}`}>{r.trend}</span></div>
                  <div/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CHALLENGES ══ */}
        {tab === "challenges" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Club challenges ⚡</h1><p className="cd-page-sub">Set targets, track progress, and keep your members motivated</p></div>
              <div className="cd-page-hdr-right">
                <button className="cd-btn cd-btn-yellow" onClick={() => setModal("challenge")}>+ New challenge</button>
              </div>
            </div>
            <div className="cd-grid-3">
              {[
                { icon: "🏃", iconBg: "var(--orange-light)", name: "100km May Run", meta: "Distance · May 1–31 · 44 participants", pct: 72, pctColor: "var(--orange)", detail: "32 / 44 members completed", lb: [{ init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.", score: "94.2km" },{ init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.", score: "88.1km" },{ init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.", score: "62.4km" }] },
                { icon: "🔥", iconBg: "var(--purple-light)", name: "Club weekly streak", meta: "Streak · Ongoing · 44 participants", pct: 89, pctColor: "var(--purple)", detail: "39 / 44 members active", lb: [{ init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.", score: "21 days" },{ init: "PW", bg: "#ECFDF5", c: "#166534", name: "Petra W.", score: "17 days" },{ init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.", score: "14 days" }] },
                { icon: "⏱", iconBg: "var(--blue-light)", name: "Sub-25 5K club", meta: "Performance · Always open · 44 eligible", pct: 38, pctColor: "var(--blue)", detail: "17 / 44 members achieved", lb: [{ init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.", score: "24:02" },{ init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.", score: "24:19" },{ init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.", score: "24:44" }] },
              ].map(ch => (
                <div key={ch.name} className="cd-ch-card">
                  <div className="cd-ch-body">
                    <div className="cd-ch-icon" style={{ background: ch.iconBg }}>{ch.icon}</div>
                    <div className="cd-ch-name">{ch.name}</div>
                    <div className="cd-ch-meta">{ch.meta}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--gray-500)", marginBottom: 5 }}><span>Progress</span><span style={{ fontFamily: "var(--mono)" }}>{ch.pct}%</span></div>
                    <div className="cd-prog-track"><div className="cd-prog-fill" style={{ width: `${ch.pct}%`, background: ch.pctColor }}/></div>
                    <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 4 }}>{ch.detail}</div>
                    <div className="cd-ch-lb-mini">
                      {ch.lb.map((r, i) => (
                        <div key={i} className="cd-ch-lb-row">
                          <div className="cd-ch-lb-rank">{i + 1}</div>
                          <div className="cd-ch-lb-av" style={{ background: r.bg, color: r.c }}>{r.init}</div>
                          <div className="cd-ch-lb-name">{r.name}</div>
                          <div className="cd-ch-lb-score">{r.score}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="cd-ch-footer">
                    <span style={{ fontSize: 11, color: "var(--gray-500)" }}>+250 pts per qualifying activity</span>
                    <div style={{ display: "flex", gap: 6 }}><button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast("Editing challenge…")}>Edit</button></div>
                  </div>
                </div>
              ))}
              <div className="cd-ch-card" style={{ borderStyle: "dashed", background: "var(--gray-50)", cursor: "pointer" }} onClick={() => setModal("challenge")}>
                <div className="cd-ch-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>+</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--gray-700)", marginBottom: 4 }}>Create a new challenge</div>
                  <div style={{ fontSize: 12, color: "var(--gray-500)" }}>Distance, streak, performance, or head-to-head</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ EVENTS ══ */}
        {tab === "events" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Club events 📅</h1><p className="cd-page-sub">Register, track RSVPs, and manage attendance across all club events</p></div>
              <div className="cd-page-hdr-right">
                <button className="cd-btn cd-btn-ghost" onClick={() => showToast("Browsing Arenas event directory…")}>🔍 Find events</button>
                <button className="cd-btn cd-btn-yellow" onClick={() => setModal("event")}>+ Add event</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { day: "13", mon: "Apr", name: "London Half Marathon",      sport: "Running", pill: "pill-run", tag: "Registration open", tagPill: "pill-new", location: "Blackheath, London · 7:00 AM start · 13.1 miles", extra: "Club deadline: Apr 6 · Entry fee: £45/member", going: 34, pending: 8, declined: 6, gPct: 70, pPct: 16 },
                { day: "19", mon: "Apr", name: "Saturday Parkrun Takeover", sport: "Running", pill: "pill-run", tag: "Club event",          tagPill: "pill-active", location: "Victoria Park, London · 9:00 AM · Free · Bring friends", extra: "", going: 22, pending: 14, declined: 2, gPct: 46, pPct: 29 },
              ].map(ev => (
                <div key={ev.name} className="cd-ev-card">
                  <div className="cd-ev-top">
                    <div className="cd-ev-date-box"><div className="cd-ed">{ev.day}</div><div className="cd-em">{ev.mon}</div></div>
                    <div className="cd-ev-info">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <div className="cd-ev-name">{ev.name}</div>
                        <span className={`cd-pill ${ev.pill}`} style={{ fontSize: 10 }}>{ev.sport}</span>
                        <span className={`cd-pill ${ev.tagPill}`} style={{ fontSize: 10 }}>{ev.tag}</span>
                      </div>
                      <div className="cd-ev-meta">{ev.location}</div>
                      {ev.extra && <div className="cd-ev-meta" style={{ marginTop: 2 }}>{ev.extra}</div>}
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      <button className="cd-btn cd-btn-sm cd-btn-primary" onClick={() => showToast("All members notified")}>📢 Notify all members</button>
                      <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setModal("event-rsvp")}>View RSVPs</button>
                    </div>
                  </div>
                  <div className="cd-ev-rsvp-bar">
                    <div className="cd-rsvp-counts">
                      <div className="cd-rsvp-item"><div className="cd-rsvp-dot" style={{ background: "var(--green)" }}/><span style={{ color: "var(--green)", fontWeight: 600 }}>{ev.going} going</span></div>
                      <div className="cd-rsvp-item"><div className="cd-rsvp-dot" style={{ background: "var(--orange)" }}/><span style={{ color: "var(--orange)" }}>{ev.pending} pending</span></div>
                      <div className="cd-rsvp-item"><div className="cd-rsvp-dot" style={{ background: "var(--gray-300)" }}/><span style={{ color: "var(--gray-500)" }}>{ev.declined} declined</span></div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, background: "var(--gray-100)", height: 6, borderRadius: 3, overflow: "hidden", display: "flex" }}>
                        <div style={{ width: `${ev.gPct}%`, background: "var(--green)" }}/>
                        <div style={{ width: `${ev.pPct}%`, background: "var(--orange)" }}/>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--gray-500)" }}>48 total</span>
                    </div>
                  </div>
                  <div className="cd-ev-footer">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="cd-ev-member-avs">
                        {[{ i:"SL",bg:"#FEF9C3",c:"#854D0E"},{i:"YT",bg:"#FCE7F3",c:"#9D174D"},{i:"AL",bg:"#E0F2FE",c:"#0369A1"},{i:"JK",bg:"#FFF7ED",c:"#9A3412"}].map((a,idx) => (
                          <div key={idx} className="cd-ev-av" style={{ background: a.bg, color: a.c }}>{a.i}</div>
                        ))}
                        <div className="cd-ev-av" style={{ background: "var(--gray-100)", color: "var(--gray-500)", fontSize: 7 }}>+{ev.going - 4}</div>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--gray-500)" }}>{ev.going} confirmed going</span>
                    </div>
                    <button className="cd-btn cd-btn-sm cd-btn-yellow" onClick={() => showToast(`Reminder sent to ${ev.pending} pending members`)}>Nudge {ev.pending} pending →</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CLUB FEED ══ */}
        {tab === "feed" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Club activity feed 🏃</h1><p className="cd-page-sub">Recent activities from all 48 Hackney Running Club members</p></div>
            </div>
            <div className="cd-card">
              {[
                { init: "SL", bg: "#FEF9C3", c: "#854D0E", text: <><strong>Sofia L.</strong> logged a morning long run</>, stats: ["88.2 km","4:18/km","142 bpm"], ai: "Excellent aerobic session — HR well controlled throughout. Glycogen stores likely well managed.", time: "2h ago · Running · 9,840 pts this week", warn: false },
                { init: "YT", bg: "#FCE7F3", c: "#9D174D", text: <><strong>Yuki T.</strong> logged a hard tempo run</>, stats: ["15.0 km","4:02/km","171 bpm"], ai: "⚠ Flag: Average HR 171bpm is 8% above Yuki's threshold. Combined with 68km this week, rest day strongly recommended.", time: "3h ago · Running · 7,610 pts this week", warn: true },
                { init: "JK", bg: "#FFF7ED", c: "#9A3412", text: <><strong>Jamie K.</strong> logged an easy recovery run</>, stats: ["12.4 km","4:23/km","148 bpm"], ai: "Smart taper run ahead of Sunday's PB attempt. Pace was appropriate for zone 2. You're well set for the race.", time: "7h ago · Running · 6,440 pts this week", warn: false },
                { init: "AL", bg: "#E0F2FE", c: "#0369A1", text: <><strong>Alena L.</strong> completed a club challenge — 100km May Run goal hit!</>, stats: [], ai: "", time: "1d ago · Running · 7,220 pts this week", warn: false },
              ].map((item, i) => (
                <div key={i} className="cd-feed-item">
                  <div className="cd-feed-av" style={{ background: item.bg, color: item.c }}>{item.init}</div>
                  <div className="cd-feed-content">
                    <div className="cd-feed-text">{item.text}</div>
                    {item.stats.length > 0 && <div className="cd-feed-stats">{item.stats.map(s => <span key={s} className="cd-feed-stat">{s}</span>)}</div>}
                    {item.ai && <div className="cd-feed-ai"><div className="cd-ai-icon">AI</div>{item.ai}</div>}
                    <div className="cd-feed-time">{item.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ REPORTS ══ */}
        {tab === "reports" && (
          <div className="cd-tab">
            <div className="cd-page-hdr">
              <div><h1 className="cd-page-h1">Club reports 📋</h1><p className="cd-page-sub">Monthly summaries, individual member reports, and performance trends</p></div>
              <div className="cd-page-hdr-right">
                <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", fontFamily: "var(--font)" }}><option>May 2026</option><option>April 2026</option><option>March 2026</option></select>
                <button className="cd-btn cd-btn-yellow" onClick={() => showToast("Generating club report PDF…")}>📥 Export PDF</button>
              </div>
            </div>
            <div className="cd-grid-4" style={{ marginBottom: 16 }}>
              {[
                { label: "Total club distance", val: "1,248 km", delta: "↑ +192km vs April" },
                { label: "Activities logged",   val: "312",       delta: "↑ +44 vs April" },
                { label: "Avg member distance", val: "26.0 km",  delta: "↑ +4km vs April" },
                { label: "Challenge completion",val: "84%",       delta: "↑ +6% vs April" },
              ].map(s => (
                <div key={s.label} className="cd-report-stat">
                  <div className="cd-rs-label">{s.label}</div>
                  <div className="cd-rs-val">{s.val}</div>
                  <div className="cd-rs-delta">{s.delta}</div>
                </div>
              ))}
            </div>
            <div className="cd-grid-2">
              <div className="cd-card">
                <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>📈</span><span className="cd-card-title">Member performance reports</span></div></div>
                {MEMBERS.slice(0,3).map(m => (
                  <div key={m.name} className="cd-feed-item" style={{ alignItems: "center" }}>
                    <div className="cd-feed-av" style={{ background: m.bg, color: m.c }}>{m.init}</div>
                    <div className="cd-feed-content">
                      <div className="cd-feed-text"><strong>{m.name}</strong> — May report ready</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{m.km} km/wk avg · {m.pts} pts{m.risk === "high" ? " · ⚠ overtraining flagged" : ""}</div>
                    </div>
                    <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast(`Generating ${m.name}'s May report PDF…`)}>📥 PDF</button>
                  </div>
                ))}
                <div style={{ padding: "10px 16px", borderTop: "var(--border)" }}><button className="cd-btn cd-btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => showToast("Generating all 48 member reports…")}>📥 Export all member reports</button></div>
              </div>
              <div className="cd-card">
                <div className="cd-card-hdr"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span>🗓</span><span className="cd-card-title">Monthly club summary</span></div></div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { label: "Most active member",  val: "Sofia L. · 88.2 km avg" },
                    { label: "Most improved",        val: "Alena L. · +14km vs April" },
                    { label: "Longest streak",       val: "Sofia L. · 21 consecutive days" },
                    { label: "Events attended",      val: "3 events · 34 member attendances" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "var(--gray-50)", border: "var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, color: "var(--gray-500)", marginBottom: 3 }}>{s.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>{s.val}</div>
                    </div>
                  ))}
                  <button className="cd-btn cd-btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => showToast("Generating full club PDF report…")}>📥 Download full club report</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ INVITE / IMPORT / HISTORY ══ */}
        {(tab === "invites" || tab === "import" || tab === "history") && (
          <ClubInviteView
            view={tab as InviteView}
            onNavigate={(v) => setTab(v as Tab)}
            showToast={showToast}
          />
        )}

      </main>

      {/* ── MODALS ── */}
      {modal && (
        <div className="cd-modal-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("cd-modal-overlay")) setModal(null); }}>
          <div className="cd-modal">

            {modal === "invite" && (
              <>
                <div className="cd-modal-hdr"><div><div className="cd-modal-title">Invite members</div><div className="cd-modal-sub">Invitations are sent by email — members set up their own Arenas profile</div></div><button className="cd-modal-close" onClick={() => setModal(null)}>✕</button></div>
                <div className="cd-modal-body">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
                        <input className="cd-form-input" type="email" placeholder="email@example.com"/>
                        <select className="cd-form-select"><option>Member</option><option>Coach</option><option>Admin</option></select>
                      </div>
                    ))}
                    <button className="cd-btn cd-btn-ghost" style={{ width: "fit-content", fontSize: 12 }} onClick={() => showToast("Row added")}>+ Add another</button>
                  </div>
                  <div style={{ background: "var(--gray-50)", border: "var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>Share join link</div><div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 2 }}>arenas.io/join/hrc-2026</div></div>
                    <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => showToast("Join link copied!")}>Copy link</button>
                  </div>
                </div>
                <div className="cd-modal-footer"><button className="cd-btn cd-btn-yellow" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setModal(null); showToast("✓ Invitations sent!"); }}>Send invitations</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
              </>
            )}

            {modal === "event" && (
              <>
                <div className="cd-modal-hdr"><div><div className="cd-modal-title">Add club event</div><div className="cd-modal-sub">Add an event and bulk-notify your members to register</div></div><button className="cd-modal-close" onClick={() => setModal(null)}>✕</button></div>
                <div className="cd-modal-body">
                  <div className="cd-form-field"><label className="cd-form-label">Event name *</label><input className="cd-form-input" type="text" placeholder="e.g. London Half Marathon"/></div>
                  <div className="cd-form-row">
                    <div className="cd-form-field"><label className="cd-form-label">Date *</label><input className="cd-form-input" type="date"/></div>
                    <div className="cd-form-field"><label className="cd-form-label">Start time</label><input className="cd-form-input" type="time"/></div>
                  </div>
                  <div className="cd-form-field"><label className="cd-form-label">Location *</label><input className="cd-form-input" type="text" placeholder="e.g. Blackheath, London"/></div>
                  <div className="cd-form-row">
                    <div className="cd-form-field"><label className="cd-form-label">Sport</label><select className="cd-form-select"><option>Running</option><option>Cycling</option><option>Swimming</option><option>Triathlon</option><option>Other</option></select></div>
                    <div className="cd-form-field"><label className="cd-form-label">Entry fee (per member)</label><input className="cd-form-input" type="text" placeholder="e.g. £45 or Free"/></div>
                  </div>
                  <div className="cd-form-field"><label className="cd-form-label">Notes for members</label><textarea className="cd-form-textarea" placeholder="Any info your members need to know…"/></div>
                  <div style={{ background: "var(--yellow-light)", border: "1px solid #fde68a", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 13, color: "#7a5c00" }}>✦ All 48 members will be notified immediately and can confirm attendance from the notification.</div>
                </div>
                <div className="cd-modal-footer"><button className="cd-btn cd-btn-yellow" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setModal(null); showToast("✓ Event created and 48 members notified!"); }}>Create &amp; notify all members</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
              </>
            )}

            {modal === "event-rsvp" && (
              <>
                <div className="cd-modal-hdr"><div><div className="cd-modal-title">London Half Marathon — RSVPs</div><div className="cd-modal-sub">Apr 13, 2026 · Blackheath, London</div></div><button className="cd-modal-close" onClick={() => setModal(null)}>✕</button></div>
                <div className="cd-modal-body">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 4 }}>
                    {[{ n:34,lbl:"Going",bg:"var(--green-light)",border:"#86EFAC",c:"#166534"},{n:8,lbl:"Pending",bg:"var(--orange-light)",border:"#FDBA74",c:"#9A3412"},{n:6,lbl:"Declined",bg:"var(--gray-100)",border:"var(--gray-200)",c:"var(--gray-600)"}].map(s => (
                      <div key={s.lbl} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "var(--radius)", padding: 12, textAlign: "center" }}><div style={{ fontSize: 24, fontWeight: 700, color: s.c, fontFamily: "var(--mono)" }}>{s.n}</div><div style={{ fontSize: 11, color: s.c }}>{s.lbl}</div></div>
                    ))}
                  </div>
                  <div style={{ overflow: "hidden", border: "var(--border)", borderRadius: "var(--radius)" }}>
                    <table className="cd-rsvp-table">
                      <thead><tr><th>Member</th><th>Status</th><th>Responded</th><th></th></tr></thead>
                      <tbody>
                        {[
                          { init:"SL",bg:"#FEF9C3",c:"#854D0E",name:"Sofia L.",status:"Going",   date:"May 15",pill:"cd-pill-going" },
                          { init:"YT",bg:"#FCE7F3",c:"#9D174D",name:"Yuki T.", status:"Going",   date:"May 16",pill:"cd-pill-going" },
                          { init:"JK",bg:"#FFF7ED",c:"#9A3412",name:"Jamie K.",status:"Pending", date:"—",      pill:"cd-pill-pending" },
                          { init:"TR",bg:"#F5F3FF",c:"#5B21B6",name:"Tom R.",  status:"Declined",date:"May 14", pill:"cd-pill-declined" },
                        ].map(r => (
                          <tr key={r.name}><td><div style={{ display:"flex",alignItems:"center",gap:7 }}><div className="cd-member-av" style={{ background:r.bg,color:r.c,width:24,height:24,fontSize:9 }}>{r.init}</div>{r.name}</div></td><td><span className={`cd-pill ${r.pill}`}>{r.status === "Going" ? "✓ Going" : r.status === "Pending" ? "⏳ Pending" : "✗ Declined"}</span></td><td style={{ fontSize:11,color:"var(--gray-400)" }}>{r.date}</td><td>{r.status === "Pending" ? <button className="cd-btn cd-btn-sm cd-btn-yellow" onClick={() => showToast(`Reminder sent to ${r.name}`)}>Nudge</button> : <button className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => showToast(`Viewing ${r.name}'s profile…`)}>View</button>}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="cd-btn cd-btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={() => { setModal(null); showToast("Reminder sent to all 8 pending members"); }}>📢 Nudge all 8 pending members</button>
                </div>
                <div className="cd-modal-footer"><button className="cd-btn cd-btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setModal(null); showToast("RSVP list exported…"); }}>📥 Export RSVP list</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Close</button></div>
              </>
            )}

            {modal === "challenge" && (
              <>
                <div className="cd-modal-hdr"><div><div className="cd-modal-title">Create club challenge</div><div className="cd-modal-sub">Private to Hackney Running Club members</div></div><button className="cd-modal-close" onClick={() => setModal(null)}>✕</button></div>
                <div className="cd-modal-body">
                  <div className="cd-form-field"><label className="cd-form-label">Challenge name *</label><input className="cd-form-input" type="text" placeholder="e.g. June 200km Club"/></div>
                  <div className="cd-form-row">
                    <div className="cd-form-field"><label className="cd-form-label">Type *</label><select className="cd-form-select"><option>Distance — total km/miles</option><option>Streak — consecutive days</option><option>Performance — hit a target</option><option>Head-to-head — 1v1</option></select></div>
                    <div className="cd-form-field"><label className="cd-form-label">Target *</label><input className="cd-form-input" type="text" placeholder="e.g. 200 km"/></div>
                  </div>
                  <div className="cd-form-row">
                    <div className="cd-form-field"><label className="cd-form-label">Start date</label><input className="cd-form-input" type="date"/></div>
                    <div className="cd-form-field"><label className="cd-form-label">End date</label><input className="cd-form-input" type="date"/></div>
                  </div>
                  <div className="cd-form-field"><label className="cd-form-label">Sport</label><select className="cd-form-select"><option>Running</option><option>Cycling</option><option>All sports</option></select></div>
                  <div style={{ background: "var(--yellow-light)", border: "1px solid #fde68a", borderRadius: "var(--radius)", padding: "12px 14px", fontSize: 13, color: "#7a5c00" }}>✦ All 48 members will be notified and automatically enrolled when you create this challenge.</div>
                </div>
                <div className="cd-modal-footer"><button className="cd-btn cd-btn-yellow" style={{ flex: 1, justifyContent: "center" }} onClick={() => { setModal(null); showToast("✓ Challenge created! 48 members notified."); }}>Create challenge</button><button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
              </>
            )}

          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      <div className={`cd-toast${toastVisible ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
