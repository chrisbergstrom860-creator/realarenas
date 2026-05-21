import { useState } from "react";
import Topbar from "../components/Topbar";
import Footer from "../components/Footer";

const activities = [
  {
    id: "a1", sport: "Running", emoji: "🏃", timeLoc: "Today · London, UK",
    stats: [{ val: "12.4", lbl: "km" }, { val: "54:22", lbl: "time" }, { val: "4:23", lbl: "/ km" }, { val: "148", lbl: "avg bpm" }, { val: "+312", lbl: "elev m" }],
    body: "Morning long run ✓ Legs felt heavy but pushed through miles 8–10. PB attempt next Sunday.",
    kudos: 24, comments: 8,
  },
  {
    id: "a2", sport: "Running", emoji: "🏃", timeLoc: "3 days ago · Richmond Park",
    stats: [{ val: "8.2", lbl: "km" }, { val: "36:10", lbl: "time" }, { val: "4:24", lbl: "/ km" }, { val: "142", lbl: "avg bpm" }],
    body: "Easy recovery run around Richmond Park. Beautiful morning. Legs coming back nicely.",
    kudos: 11, comments: 3,
  },
  {
    id: "a3", sport: "Running", emoji: "🏃", timeLoc: "5 days ago · Hampstead Heath",
    stats: [{ val: "16.0", lbl: "km" }, { val: "1:13:40", lbl: "time" }, { val: "4:36", lbl: "/ km" }, { val: "152", lbl: "avg bpm" }, { val: "+480", lbl: "elev m" }],
    body: "Long run with the club. Hilly course — solid aerobic base work. Tired but happy.",
    kudos: 33, comments: 14,
  },
];

const sportBreakdown = [
  { sport: "Running", dot: "#F97316", acts: 48, km: "421 km" },
  { sport: "Cycling", dot: "#3B82F6", acts: 6, km: "188 km" },
  { sport: "Swimming", dot: "#14B8A6", acts: 3, km: "12 km" },
];

const achievements = [
  { emoji: "🏅", label: "100km month", desc: "Logged 100km in a month", earned: true },
  { emoji: "🔥", label: "7-day streak", desc: "Active 7 days in a row", earned: true },
  { emoji: "⚡", label: "Sub-4:30 /km", desc: "Hit a sub 4:30 pace", earned: true },
  { emoji: "🚀", label: "First marathon", desc: "Completed 42.2km", earned: false },
  { emoji: "👑", label: "Top 10 weekly", desc: "Reached weekly top 10", earned: false },
  { emoji: "🌍", label: "3 countries", desc: "Activity in 3 countries", earned: false },
];

const weekData = [
  { day: "Mon", km: 8.2 }, { day: "Tue", km: 0 }, { day: "Wed", km: 12.4 },
  { day: "Thu", km: 5.0 }, { day: "Fri", km: 0 }, { day: "Sat", km: 16.0 }, { day: "Sun", km: 0 },
];
const maxKm = Math.max(...weekData.map(d => d.km), 1);

const prs = [
  { label: "5K", value: "21:48", date: "Mar 2026" },
  { label: "10K", value: "45:22", date: "Jan 2026" },
  { label: "Half Marathon", value: "1:42:11", date: "Oct 2025" },
  { label: "Longest run", value: "28.4 km", date: "Feb 2026" },
];

const upcomingEvents = [
  { day: "13", mon: "Apr", name: "Berlin Half Marathon", meta: "Berlin, Germany" },
  { day: "3", mon: "May", name: "Urban Bouldering League", meta: "London, UK" },
];

export default function Profile() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [kudosState, setKudosState] = useState<Record<string, boolean>>({});
  const tabs = ["Overview", "Activities", "Achievements", "Following"];

  function toggleKudos(id: string) {
    setKudosState(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--gray-50)" }}>
      <Topbar loggedIn />

      {/* Profile hero */}
      <div style={{ background: "white", borderBottom: "var(--border)" }}>
        {/* Cover banner */}
        <div style={{ height: "120px", background: "linear-gradient(135deg, #FFD21E 0%, #FFF9E0 60%, #F3F4F6 100%)" }} />

        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "20px", marginTop: "-36px", paddingBottom: "20px" }}>
            {/* Avatar */}
            <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "#FFF7ED", border: "3px solid white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "#9A3412", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
              data-testid="profile-avatar">JK</div>

            <div style={{ flex: 1, paddingBottom: "4px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--gray-900)", lineHeight: 1.2 }} data-testid="profile-name">Jamie K.</h1>
                  <p style={{ fontSize: "13px", color: "var(--gray-500)", marginTop: "2px" }}>📍 London, UK &nbsp;·&nbsp; 🏃 Running &nbsp;·&nbsp; Intermediate</p>
                  <p style={{ fontSize: "13px", color: "var(--gray-600)", marginTop: "6px", maxWidth: "480px" }}>
                    Chasing a sub-4:00/km average this year. Marathon aspirant. Weekend parkrun regular. Always up for a group run.
                  </p>
                  <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                    <span style={{ fontSize: "13px", color: "var(--gray-600)" }}><strong style={{ color: "var(--gray-900)" }}>640</strong> followers</span>
                    <span style={{ fontSize: "13px", color: "var(--gray-600)" }}><strong style={{ color: "var(--gray-900)" }}>218</strong> following</span>
                    <span style={{ fontSize: "13px", color: "var(--gray-600)" }}>Member since Jan 2024</span>
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: "13px", marginTop: "auto" }} data-testid="btn-edit-profile">Edit profile</button>
              </div>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ borderTop: "var(--border)", background: "var(--gray-50)" }}>
          <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 24px", display: "flex", gap: "0" }}>
            {[
              { num: "57", lbl: "Activities" }, { num: "621", lbl: "km logged" },
              { num: "6", lbl: "Day streak 🔥" }, { num: "6,440", lbl: "Points" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "14px 24px", borderRight: "var(--border)", textAlign: "center" }} data-testid={`stat-${s.lbl.replace(/\s+/g, "-").toLowerCase()}`}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--gray-900)", fontFamily: "var(--mono)" }}>{s.num}</div>
                <div style={{ fontSize: "11px", color: "var(--gray-500)", marginTop: "1px" }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Profile tabs */}
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center" }}>
          {tabs.map(tab => (
            <div
              key={tab}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              data-testid={`profile-tab-${tab.toLowerCase()}`}
            >{tab}</div>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <main className="main">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Sport breakdown */}
          <div className="sidebar-card">
            <div className="sidebar-section-title">Sport breakdown</div>
            <div className="filter-group">
              {sportBreakdown.map(s => (
                <div className="filter-item" key={s.sport} data-testid={`sport-breakdown-${s.sport.toLowerCase()}`}>
                  <div className="filter-item-left">
                    <div className="filter-dot" style={{ background: s.dot }} />
                    {s.sport}
                  </div>
                  <span className="filter-count">{s.acts} acts</span>
                </div>
              ))}
            </div>
          </div>

          {/* Personal records */}
          <div className="sidebar-card">
            <div className="sidebar-section-title">Personal records</div>
            <div style={{ padding: "4px 14px 12px" }}>
              {prs.map(pr => (
                <div key={pr.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--gray-100)" }} data-testid={`pr-${pr.label.replace(/\s+/g, "-").toLowerCase()}`}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--gray-800)" }}>{pr.label}</div>
                    <div style={{ fontSize: "11px", color: "var(--gray-400)" }}>{pr.date}</div>
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "13px", fontWeight: 600, color: "var(--gray-900)" }}>{pr.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming events */}
          <div className="sidebar-card">
            <div className="sidebar-section-title">My events</div>
            {upcomingEvents.map(e => (
              <div className="lb-row" key={e.name} style={{ gap: "12px" }} data-testid={`my-event-${e.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <div style={{ width: "34px", height: "34px", background: "var(--yellow)", borderRadius: "7px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1, fontFamily: "var(--mono)" }}>{e.day}</div>
                  <div style={{ fontSize: "9px", fontWeight: 600, textTransform: "uppercase", color: "var(--gray-700)" }}>{e.mon}</div>
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--gray-800)" }}>{e.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--gray-400)" }}>{e.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Content */}
        <div className="grid-wrap">

          {activeTab === "Overview" && (
            <>
              {/* Weekly bar chart */}
              <div>
                <div className="section-header">
                  <h2>This week</h2>
                  <span style={{ fontSize: "13px", color: "var(--gray-500)" }}>41.6 km total</span>
                </div>
                <div style={{ background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 20px 12px" }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "80px" }}>
                    {weekData.map(d => (
                      <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                        <div style={{ fontSize: "10px", fontFamily: "var(--mono)", color: d.km > 0 ? "var(--gray-600)" : "transparent" }}>{d.km > 0 ? d.km : ""}</div>
                        <div style={{ width: "100%", background: d.km > 0 ? "var(--yellow)" : "var(--gray-100)", borderRadius: "4px 4px 0 0", height: `${(d.km / maxKm) * 56}px`, minHeight: d.km > 0 ? "6px" : "4px", transition: "height 0.3s" }} data-testid={`bar-${d.day.toLowerCase()}`} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    {weekData.map(d => (
                      <div key={d.day} style={{ flex: 1, textAlign: "center", fontSize: "11px", color: "var(--gray-400)", fontWeight: 500 }}>{d.day}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent activities */}
              <div>
                <div className="section-header" style={{ marginTop: "8px" }}>
                  <h2>Recent activities</h2>
                  <a href="#" onClick={(e) => { e.preventDefault(); setActiveTab("Activities"); }} style={{ fontSize: "13px", color: "var(--gray-500)", textDecoration: "none" }}>View all →</a>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {activities.slice(0, 2).map(act => (
                    <ActivityRow key={act.id} act={act} liked={!!kudosState[act.id]} onKudos={() => toggleKudos(act.id)} />
                  ))}
                </div>
              </div>

              {/* Achievements preview */}
              <div>
                <div className="section-header" style={{ marginTop: "8px" }}>
                  <h2>Achievements</h2>
                  <a href="#" onClick={(e) => { e.preventDefault(); setActiveTab("Achievements"); }} style={{ fontSize: "13px", color: "var(--gray-500)", textDecoration: "none" }}>View all →</a>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                  {achievements.map(a => (
                    <div key={a.label} style={{ background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "6px", opacity: a.earned ? 1 : 0.45 }} data-testid={`achievement-${a.label.replace(/\s+/g, "-").toLowerCase()}`}>
                      <div style={{ fontSize: "22px" }}>{a.emoji}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--gray-900)" }}>{a.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--gray-500)" }}>{a.desc}</div>
                      {a.earned && <div style={{ fontSize: "11px", color: "#10B981", fontWeight: 500 }}>✓ Earned</div>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === "Activities" && (
            <div>
              <div className="section-header">
                <h2>All activities</h2>
                <span style={{ fontSize: "13px", color: "var(--gray-500)" }}>57 total</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {activities.map(act => (
                  <ActivityRow key={act.id} act={act} liked={!!kudosState[act.id]} onKudos={() => toggleKudos(act.id)} />
                ))}
              </div>
            </div>
          )}

          {activeTab === "Achievements" && (
            <div>
              <div className="section-header">
                <h2>Achievements</h2>
                <span style={{ fontSize: "13px", color: "var(--gray-500)" }}>3 / 6 earned</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {achievements.map(a => (
                  <div key={a.label} style={{ background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 18px", display: "flex", flexDirection: "column", gap: "8px", opacity: a.earned ? 1 : 0.4, position: "relative", overflow: "hidden" }} data-testid={`achievement-full-${a.label.replace(/\s+/g, "-").toLowerCase()}`}>
                    {a.earned && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "var(--yellow)" }} />}
                    <div style={{ fontSize: "28px" }}>{a.emoji}</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--gray-900)" }}>{a.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--gray-500)" }}>{a.desc}</div>
                    <div style={{ fontSize: "12px", fontWeight: 500, color: a.earned ? "#10B981" : "var(--gray-400)" }}>
                      {a.earned ? "✓ Earned" : "🔒 Locked"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "Following" && (
            <div>
              <div className="section-header">
                <h2>Following</h2>
                <span style={{ fontSize: "13px", color: "var(--gray-500)" }}>218 athletes</span>
              </div>
              <div className="cards-grid">
                {[
                  { emoji: "🏃", bg: "#FEF9C3", name: "Sofia L.", loc: "Prague · Running", desc: "Marathon runner chasing sub-2:55.", tags: ["Running", "Advanced"], pts: "9,840 pts" },
                  { emoji: "🚴", bg: "#E0F2FE", name: "Marco C.", loc: "Milan · Cycling", desc: "Granfondo specialist, 40k km in 2025.", tags: ["Cycling", "Elite / Pro"], pts: "8,120 pts" },
                  { emoji: "🧗", bg: "#ECFDF5", name: "Alena M.", loc: "Barcelona · Climbing", desc: "Sport climbing 7c+ and projecting 8a.", tags: ["Climbing", "Advanced"], pts: "5,220 pts" },
                  { emoji: "🏊", bg: "#E0F2FE", name: "Yuki T.", loc: "Tokyo · Swimming", desc: "Open water swimmer, Geneva 5K prep.", tags: ["Swimming", "Advanced"], pts: "7,610 pts" },
                  { emoji: "⚽", bg: "#F0FDF4", name: "Omar B.", loc: "Berlin · Football", desc: "5-a-side captain, Berlin street league.", tags: ["Football", "Beginner"], pts: "6,990 pts" },
                  { emoji: "🎾", bg: "#FFF7ED", name: "Lena V.", loc: "Paris · Tennis", desc: "Social tennis and match play in Paris.", tags: ["Tennis", "Intermediate"], pts: "3,110 pts" },
                ].map(a => (
                  <div className="card" key={a.name} data-testid={`following-card-${a.name.replace(" ", "-").toLowerCase()}`}>
                    <div className="card-top">
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <div className="card-avatar" style={{ background: a.bg }}>{a.emoji}</div>
                        <div>
                          <div className="card-title">{a.name}</div>
                          <div className="card-author">{a.loc}</div>
                        </div>
                      </div>
                    </div>
                    <div className="card-desc">{a.desc}</div>
                    <div className="card-tags">{a.tags.map(t => <span key={t} className="tag sport">{t}</span>)}</div>
                    <div className="card-footer">
                      <div className="card-stat">⭐ {a.pts}</div>
                      <button className="act-btn liked" style={{ fontSize: "11px" }} data-testid={`btn-following-${a.name.replace(" ", "-").toLowerCase()}`}>Following</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      <Footer />
    </div>
  );
}

interface ActivityRowProps {
  act: typeof activities[0];
  liked: boolean;
  onKudos: () => void;
}

function ActivityRow({ act, liked, onKudos }: ActivityRowProps) {
  return (
    <div className="activity-card" data-testid={`activity-card-${act.id}`}>
      <div className="activity-card-body">
        <div className="act-header">
          <div className="act-avatar" style={{ background: "#FFF7ED", color: "#9A3412", fontWeight: 700, fontSize: "13px" }}>JK</div>
          <div className="act-meta">
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <div className="act-user">Jamie K.</div>
              <span className="tag sport" style={{ fontSize: "10px" }}>{act.emoji} {act.sport}</span>
            </div>
            <div className="act-time">{act.timeLoc}</div>
          </div>
        </div>
        <div className="act-stats">
          {act.stats.map(s => (
            <div className="act-stat-pill" key={s.lbl}>
              <div className="val">{s.val}</div>
              <div className="lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
        <div className="act-body">{act.body}</div>
        <div className="act-actions">
          <button
            className={`act-btn ${liked ? "liked" : ""}`}
            onClick={onKudos}
            data-testid={`btn-kudos-${act.id}`}
          >
            👍 {liked ? act.kudos + 1 : act.kudos} kudos
          </button>
          <button className="act-btn" data-testid={`btn-comments-${act.id}`}>💬 {act.comments} comments</button>
          <button className="act-btn" data-testid={`btn-route-${act.id}`}>📍 View route</button>
        </div>
      </div>
    </div>
  );
}
