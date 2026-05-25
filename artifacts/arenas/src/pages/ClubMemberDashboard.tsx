import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

type Tab = "overview" | "feed" | "leaderboard" | "challenges" | "events" | "members" | "notifications";
type Modal = "comment" | "event-detail" | "challenge-browse" | null;

const MEMBERS = [
  { id: "SL", name: "Sofia L.", handle: "@sofialopes", loc: "Prague, CZ", role: "Coach", bg: "#FEF9C3", fg: "#854D0E", pts: "9,840", km: "88km", streak: "21d", streakDots: [1,1,1,1,1,1,2], level: "Advanced", isCoach: true },
  { id: "YT", name: "Yuki T.", handle: "@yukitri", loc: "Tokyo, JP", role: "", bg: "#FCE7F3", fg: "#9D174D", pts: "7,610", km: "68km", streak: "14d", streakDots: [1,1,1,1,1,1,2], level: "Advanced", isCoach: false },
  { id: "AL", name: "Alena L.", handle: "@alenaprague", loc: "London, UK", role: "", bg: "#E0F2FE", fg: "#0369A1", pts: "7,220", km: "71km", streak: "6d", streakDots: [1,1,0,1,1,1,2], level: "Advanced", isCoach: false },
  { id: "PR", name: "Priya R.", handle: "@priyaruns", loc: "Mumbai, IN", role: "", bg: "#FBEAF0", fg: "#72243E", pts: "6,980", km: "62km", streak: "6d", streakDots: [1,1,1,1,0,1,2], level: "Advanced", isCoach: false },
  { id: "TR", name: "Tom R.", handle: "@tomruns", loc: "London, UK", role: "", bg: "#F5F3FF", fg: "#5B21B6", pts: "5,880", km: "21km", streak: "4d", streakDots: [1,1,1,0,1,1,2], level: "Intermediate", isCoach: false },
];

export default function ClubMemberDashboard() {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [likedActivities, setLikedActivities] = useState<Set<number>>(new Set([0]));
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({ SL: true, YT: true });
  const [rsvpHalf, setRsvpHalf] = useState(false);
  const [rsvpParkrun] = useState(true);
  const [lbPeriod, setLbPeriod] = useState("This week");
  const [lbMetric, setLbMetric] = useState("Points");
  const [commentText, setCommentText] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2800);
  }, []);

  function nav(t: Tab) { setTab(t); window.scrollTo(0, 0); }

  function toggleFollow(id: string) {
    const next = !followStates[id];
    setFollowStates(p => ({ ...p, [id]: next }));
    showToast(next ? "✓ Following — they'll appear in your personal feed" : "Unfollowed");
  }

  function toggleLike(idx: number) {
    setLikedActivities(p => { const s = new Set(p); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });
  }

  const Btn = ({ cls = "", onClick, children }: { cls?: string; onClick?: () => void; children: React.ReactNode }) => (
    <button className={`cm-btn ${cls}`} onClick={onClick}>{children}</button>
  );

  const StreakDots = ({ dots }: { dots: number[] }) => (
    <div className="cm-streak-row">
      {dots.map((d, i) => (
        <div key={i} className={`cm-s-dot ${d === 1 ? "cm-sd-done" : d === 2 ? "cm-sd-today" : d === 3 ? "cm-sd-miss" : "cm-sd-fut"}`}>
          {d === 1 ? "✓" : d === 2 ? "T" : d === 3 ? "✗" : ""}
        </div>
      ))}
    </div>
  );

  const MiniLb = ({ rows }: { rows: { rank: string; id: string; bg: string; fg: string; name: string; score: string; isYou?: boolean }[] }) => (
    <div className="cm-mini-lb">
      {rows.map((r, i) => (
        <div key={i} className="cm-mini-lb-row">
          <span className="cm-mini-lb-rank">{r.rank}</span>
          <div className="cm-mini-lb-av" style={{ background: r.bg, color: r.fg }}>{r.id}</div>
          <span className="cm-mini-lb-name">{r.name}</span>
          <span className="cm-mini-lb-score">{r.score}</span>
          {r.isYou && <span className="cm-mini-lb-you">you</span>}
        </div>
      ))}
    </div>
  );

  const FollowBtn = ({ id }: { id: string }) => {
    const following = followStates[id] ?? false;
    return (
      <button
        className={`cm-follow-btn ${following ? "following" : ""}`}
        onClick={e => { e.stopPropagation(); toggleFollow(id); }}
      >
        {following ? "Following" : "Follow"}
      </button>
    );
  };

  return (
    <div className="cm-app">
      {/* ── TOPBAR ── */}
      <header className="cm-topbar">
        <div className="cm-topbar-logo">
          <div style={{ width: 28, height: 28, background: "var(--yellow)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🏟</div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gray-900)" }}>Arenas</span>
        </div>
        <div className="cm-topbar-center">
          <div className="cm-search">
            <span style={{ color: "var(--gray-400)", fontSize: 13 }}>🔍</span>
            <input type="text" placeholder="Search athletes, events, challenges…" />
          </div>
          <div className="cm-club-pill" onClick={() => nav("overview")}>
            <div style={{ width: 20, height: 20, borderRadius: 5, background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>🏃</div>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--gray-800)" }}>Hackney Running Club</span>
          </div>
        </div>
        <div className="cm-topbar-actions">
          <div className="cm-notif-btn" onClick={() => nav("notifications")}>
            🔔<div className="cm-notif-dot" />
          </div>
          <div className="cm-av-btn" onClick={() => setLocation("/profile")}>JK</div>
          <button className="cm-btn cm-btn-ghost cm-btn-sm" style={{ marginLeft: 4 }} onClick={() => { logout(); setLocation("/"); }}>Log out</button>
        </div>
      </header>

      {/* ── SIDEBAR ── */}
      <aside className="cm-sidebar">
        <div className="cm-nav-label">My Arenas</div>
        <div className="cm-nav-item" onClick={() => setLocation("/feed")}><span className="cm-nav-icon">🏠</span> My feed</div>
        <div className="cm-nav-item" onClick={() => setLocation("/profile")}><span className="cm-nav-icon">👤</span> My profile</div>
        <div className="cm-nav-item" onClick={() => showToast("Going to events near you…")}><span className="cm-nav-icon">📅</span> Events</div>

        <div className="cm-nav-label" style={{ marginTop: 4 }}>Hackney Running Club</div>
        <div className="cm-club-hdr">
          <div className="cm-club-hdr-icon">🏃</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>Hackney RC</div>
            <div style={{ fontSize: 11, color: "var(--gray-500)" }}>48 members · Club Pro</div>
          </div>
        </div>
        {([
          ["overview",      "📊", "Overview",       ""],
          ["feed",          "🏃", "Club feed",       "4"],
          ["leaderboard",   "🏆", "Leaderboard",     ""],
          ["challenges",    "⚡", "Challenges",      "3"],
          ["events",        "📅", "Club events",     "2red"],
          ["members",       "👥", "Members",         ""],
          ["notifications", "🔔", "Notifications",   "3red"],
        ] as [Tab, string, string, string][]).map(([id, icon, label, badge]) => (
          <div key={id} className={`cm-nav-item ${tab === id ? "active" : ""}`} onClick={() => nav(id)}>
            <span className="cm-nav-icon">{icon}</span>
            {label}
            {badge && (
              <span className={`cm-badge ${badge.endsWith("red") ? "cm-badge-red" : ""}`}>
                {badge.replace("red", "")}
              </span>
            )}
          </div>
        ))}

        <div className="cm-sf">
          <div className="cm-sf-row">
            <div className="cm-sf-av">JK</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-900)" }}>Jamie K.</div>
              <div style={{ fontSize: 10, color: "var(--gray-500)" }}>Member · Running</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="cm-main">

        {/* ════ OVERVIEW ════ */}
        <div className={`cm-tab ${tab === "overview" ? "active" : ""}`}>
          {showBanner && (
            <div className="cm-banner">
              <div className="cm-banner-icon">🎉</div>
              <div className="cm-banner-text">
                <div className="cm-banner-title">Welcome to Hackney Running Club, Jamie!</div>
                <div className="cm-banner-sub">You joined 2 days ago. Connect Strava to start logging activities and appear on the leaderboard.</div>
              </div>
              <div className="cm-banner-actions">
                <Btn cls="cm-btn-yellow" onClick={() => showToast("Connecting Strava…")}>Connect Strava →</Btn>
                <button className="cm-btn cm-btn-ghost" style={{ color: "rgba(255,255,255,0.5)", borderColor: "rgba(255,255,255,0.2)" }} onClick={() => setShowBanner(false)}>Dismiss</button>
              </div>
            </div>
          )}

          <div className="cm-page-hdr">
            <div><h1>Club overview 👋</h1><p>Hackney Running Club · Week of May 15–22, 2026</p></div>
            <div className="cm-page-hdr-right">
              <Btn cls="cm-btn-ghost" onClick={() => nav("events")}>📅 View events</Btn>
              <Btn cls="cm-btn-yellow" onClick={() => setModal("challenge-browse")}>⚡ Join a challenge</Btn>
            </div>
          </div>

          <div className="cm-grid-4" style={{ marginBottom: 16 }}>
            {[
              { label: "Your club rank", value: "#5", delta: "up", d: "↑ +3 this week" },
              { label: "Your points", value: "6,440", delta: "neutral", d: "540 to rank #4" },
              { label: "Activities this week", value: "3", delta: "up", d: "↑ +1 vs last week" },
              { label: "Current streak", value: "6", delta: "neutral", d: "days · best: 14" },
            ].map(s => (
              <div key={s.label} className="cm-stat">
                <div className="cm-stat-label">{s.label}</div>
                <div className="cm-stat-value">{s.value}</div>
                <div className={`cm-stat-delta ${s.delta}`}>{s.d}</div>
              </div>
            ))}
          </div>

          <div className="cm-grid-3">
            {/* Leaderboard snippet */}
            <div className="cm-card">
              <div className="cm-card-hdr">
                <span>🏆 Club leaderboard</span>
                <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => nav("leaderboard")}>Full board →</Btn>
              </div>
              <div>
                {[
                  { rank: "1", rc: "r1", id: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", detail: "88.2 km", score: "9,840", trend: "↑+1", tc: "cm-trend-up", you: false },
                  { rank: "2", rc: "r2", id: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", detail: "68.0 km", score: "7,610", trend: "↑+2", tc: "cm-trend-up", you: false },
                  { rank: "3", rc: "r3", id: "AL", bg: "#E0F2FE", fg: "#0369A1", name: "Alena L.", detail: "71.4 km", score: "7,220", trend: "—", tc: "cm-trend-eq", you: false },
                  { rank: "5", rc: "", id: "JK", bg: "#FFF7ED", fg: "#9A3412", name: "Jamie K.", detail: "12.4 km", score: "6,440", trend: "↑+3", tc: "cm-trend-up", you: true },
                ].map(r => (
                  <div key={r.rank} className={`cm-lb-row ${r.you ? "you" : ""}`}>
                    <div className={`cm-lb-rank ${r.rc}`}>{r.rank}</div>
                    <div className="cm-lb-athlete">
                      <div className="cm-lb-av" style={{ background: r.bg, color: r.fg }}>{r.id}</div>
                      <div><div className="cm-lb-name">{r.name}</div><div className="cm-lb-detail">{r.detail}</div></div>
                    </div>
                    <div style={{ textAlign: "right" }}><div className="cm-lb-score">{r.score}</div></div>
                    <div><span className={`cm-trend ${r.tc}`}>{r.trend}</span></div>
                    <div>{r.you && <span className="cm-you-tag">you</span>}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Active challenge */}
            <div className="cm-card">
              <div className="cm-card-hdr">
                <span>⚡ 100km May Run</span>
                <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => nav("challenges")}>All →</Btn>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5, color: "var(--gray-600)" }}>
                    <span>Your progress</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--gray-900)" }}>62 / 100 km</span>
                  </div>
                  <div className="cm-prog-track"><div className="cm-prog-fill" style={{ width: "62%", background: "#F97316" }} /></div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 4 }}>38 km remaining · 9 days left · you're rank #5</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-700)", marginBottom: 4 }}>Your activity log</div>
                <StreakDots dots={[1,1,1,3,1,1,2,0,0]} />
                <div style={{ background: "#FFF9E0", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#7a5c00" }}>
                  💡 Log a 5km run today to hit 67km — that puts you past Tom R. for rank #4.
                </div>
              </div>
            </div>

            {/* Next event */}
            <div className="cm-card">
              <div className="cm-card-hdr">
                <span>📅 Next club event</span>
                <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => nav("events")}>All →</Btn>
              </div>
              <div style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div className="cm-ev-date-box" style={{ width: 44, height: 44, flexShrink: 0 }}>
                    <div className="ed" style={{ fontSize: 16 }}>13</div>
                    <div className="em">Apr</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--gray-900)", marginBottom: 2 }}>London Half Marathon</div>
                    <div style={{ fontSize: 12, color: "var(--gray-500)" }}>Blackheath · 7:00 AM · £45</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                      <span className="cm-pill cm-pill-run">Running</span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#166534", border: "1px solid #86EFAC" }}>34 going</span>
                    </div>
                  </div>
                </div>
                <div style={{ background: "var(--gray-50)", border: "var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "var(--gray-600)", marginBottom: 12 }}>
                  <strong style={{ color: "var(--gray-900)" }}>Coach Rachel says:</strong> Great flat course for a PB. We'll meet at the start village at 6:30 AM.
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  {rsvpHalf
                    ? <Btn cls="cm-btn-green cm-btn-sm">✓ Going</Btn>
                    : <Btn cls="cm-btn-yellow cm-btn-sm" onClick={() => { setRsvpHalf(true); showToast("✓ RSVP confirmed — Coach Rachel has been notified!"); }}>✓ I'm going</Btn>
                  }
                  <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => showToast("You declined this event")}>Can't make it</Btn>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ════ CLUB FEED ════ */}
        <div className={`cm-tab ${tab === "feed" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Club feed 🏃</h1><p>Activities from your 48 Hackney Running Club teammates</p></div>
            <div className="cm-page-hdr-right">
              <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer" }}>
                <option>All sports</option><option>Running</option><option>Cycling</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Activity 1 — Sofia */}
            <div className="cm-act-card">
              <div className="cm-act-body">
                <div className="cm-act-head">
                  <div className="cm-act-av" style={{ background: "#FEF9C3", color: "#854D0E" }}>SL</div>
                  <div><div className="cm-act-user">Sofia L.</div><div className="cm-act-time">2h ago · London</div></div>
                  <div className="cm-act-sport" style={{ background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                </div>
                <div className="cm-act-stats">
                  {[["88.2","km"],["4:18","/km"],["142","bpm"],["+420","elev m"]].map(([v,l]) => (
                    <div key={l} className="cm-act-stat"><div className="sv">{v}</div><div className="sl">{l}</div></div>
                  ))}
                </div>
                <div className="cm-act-desc">Weekly long run done — that's 94.2km for the month. One more big effort and I'll hit 100km before May 31. Anyone else pushing for it this weekend?</div>
                <div className="cm-ai-box">
                  <div className="cm-ai-icon">AI</div>
                  <div className="cm-ai-text"><strong>AI Coach:</strong> Excellent aerobic base run — HR held steady throughout which suggests great fat adaptation. A good taper day tomorrow before any hard work this week.</div>
                </div>
              </div>
              <div className="cm-act-footer">
                <button className={`cm-act-btn ${likedActivities.has(0) ? "liked" : ""}`} onClick={() => toggleLike(0)}>
                  👍 {likedActivities.has(0) ? 24 : 23} kudos
                </button>
                <button className="cm-act-btn" onClick={() => setModal("comment")}>💬 8 comments</button>
                <button className="cm-act-btn" onClick={() => showToast("Route saved to your library")}>📍 Save route</button>
                <span style={{ fontSize: 11, color: "var(--gray-400)", marginLeft: "auto" }}>🏆 Rank #1 this week</span>
              </div>
            </div>

            {/* Activity 2 — Jamie (you) */}
            <div className="cm-act-card">
              <div className="cm-act-body">
                <div className="cm-act-head">
                  <div className="cm-act-av" style={{ background: "#FFF7ED", color: "#9A3412" }}>JK</div>
                  <div>
                    <div className="cm-act-user">Jamie K. <span style={{ fontSize: 11, fontWeight: 400, color: "var(--gray-400)" }}>(you)</span></div>
                    <div className="cm-act-time">7h ago · London</div>
                  </div>
                  <div className="cm-act-sport" style={{ background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                </div>
                <div className="cm-act-stats">
                  {[["12.4","km"],["54:22","time"],["4:23","/km"],["148","bpm"]].map(([v,l]) => (
                    <div key={l} className="cm-act-stat"><div className="sv">{v}</div><div className="sl">{l}</div></div>
                  ))}
                </div>
                <div className="cm-act-desc">Morning long run ✓ Legs felt heavy in miles 8–10 but pushed through. PB attempt this Sunday — anyone in London want to pace the last 5km?</div>
                <div className="cm-ai-box">
                  <div className="cm-ai-icon">AI</div>
                  <div className="cm-ai-text"><strong>AI Coach:</strong> HR spiked 12 bpm in the final 3km — classic glycogen depletion. Keep tomorrow easy and you'll be fresh for Sunday's PB attempt. Consider fuelling at km 8 next long run.</div>
                </div>
              </div>
              <div className="cm-act-footer">
                <button className={`cm-act-btn ${likedActivities.has(1) ? "liked" : ""}`} onClick={() => toggleLike(1)}>
                  👍 {likedActivities.has(1) ? 7 : 6} kudos
                </button>
                <button className="cm-act-btn" onClick={() => setModal("comment")}>💬 3 comments</button>
                <button className="cm-act-btn" onClick={() => showToast("Editing activity…")}>✏️ Edit</button>
              </div>
            </div>

            {/* Activity 3 — Alena */}
            <div className="cm-act-card">
              <div className="cm-act-body">
                <div className="cm-act-head">
                  <div className="cm-act-av" style={{ background: "#E0F2FE", color: "#0369A1" }}>AL</div>
                  <div><div className="cm-act-user">Alena L.</div><div className="cm-act-time">1d ago · London</div></div>
                  <div className="cm-act-sport" style={{ background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                </div>
                <div className="cm-act-stats">
                  {[["71.4","km"],["4:30","/km"],["138","bpm"]].map(([v,l]) => (
                    <div key={l} className="cm-act-stat"><div className="sv">{v}</div><div className="sl">{l}</div></div>
                  ))}
                </div>
                <div className="cm-act-desc">Smashed the 100km May Run target early! 🎉 Thanks everyone in Hackney RC for the motivation — the private leaderboard kept me honest every single day this month.</div>
              </div>
              <div className="cm-act-footer">
                <button className={`cm-act-btn ${likedActivities.has(2) ? "liked" : ""}`} onClick={() => toggleLike(2)}>
                  👍 {likedActivities.has(2) ? 32 : 31} kudos
                </button>
                <button className="cm-act-btn" onClick={() => setModal("comment")}>💬 14 comments</button>
                <span style={{ fontSize: 11, color: "#10B981", fontWeight: 600, marginLeft: "auto" }}>⚡ Challenge complete!</span>
              </div>
            </div>

          </div>
        </div>

        {/* ════ LEADERBOARD ════ */}
        <div className={`cm-tab ${tab === "leaderboard" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Club leaderboard 🏆</h1><p>Private rankings — Hackney Running Club only · Updated every Monday</p></div>
            <div className="cm-page-hdr-right">
              <select value={lbPeriod} onChange={e => { setLbPeriod(e.target.value); showToast("Leaderboard updated"); }}
                style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer" }}>
                <option>This week</option><option>This month</option><option>All time</option>
              </select>
              <select value={lbMetric} onChange={e => { setLbMetric(e.target.value); showToast("Metric updated"); }}
                style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer" }}>
                <option>Points</option><option>Distance (km)</option><option>Activities</option><option>Streak (days)</option>
              </select>
            </div>
          </div>

          {/* Your position banner */}
          <div style={{ background: "var(--gray-900)", borderRadius: "var(--radius-lg)", padding: "18px 22px", display: "flex", alignItems: "center", gap: 18, marginBottom: 16, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, background: "radial-gradient(circle,rgba(255,210,30,0.12) 0%,transparent 70%)", pointerEvents: "none" }} />
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--yellow)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "var(--gray-900)", flexShrink: 0, position: "relative", zIndex: 1 }}>JK</div>
            <div style={{ flex: 1, position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "white", marginBottom: 2 }}>Your ranking — Jamie K.</div>
              <div style={{ fontSize: 12, color: "var(--gray-400)" }}>Running · Advanced · London</div>
            </div>
            <div style={{ display: "flex", gap: 20, position: "relative", zIndex: 1 }}>
              {[["#5","Club rank"],["6,440","Points"],["12.4","km this week"]].map(([v,l]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "white", fontFamily: "var(--mono)" }}>{v}</div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 180, position: "relative", zIndex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--gray-400)", marginBottom: 6 }}>
                <span>Progress to rank #4</span>
                <span style={{ fontFamily: "var(--mono)" }}>6,440 / 6,980</span>
              </div>
              <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: "92%", height: "100%", background: "var(--yellow)", borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 5 }}>540 pts to overtake Priya R. — log one more run this week.</div>
            </div>
          </div>

          {/* Podium */}
          <div className="cm-card" style={{ marginBottom: 14 }}>
            <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "end", gap: 8 }}>
              {[
                { medal: "🥈", id: "YT", bg: "#FCE7F3", fg: "#9D174D", borderCol: "#9CA3AF", glowBg: "#F9FAFB", name: "Yuki T.", city: "Tokyo", pts: "7,610", barH: 36, barGrad: "linear-gradient(180deg,#F3F4F6,#D1D5DB)", size: 48, fs: 15 },
                { medal: "🥇", id: "SL", bg: "#FEF9C3", fg: "#854D0E", borderCol: "#F59E0B", glowBg: "#FFFBEB", name: "Sofia L.", city: "Prague", pts: "9,840", barH: 54, barGrad: "linear-gradient(180deg,#FEF9C3,#FDE68A)", size: 54, fs: 17 },
                { medal: "🥉", id: "AL", bg: "#E0F2FE", fg: "#0369A1", borderCol: "#B45309", glowBg: "#FFFBEB", name: "Alena L.", city: "London", pts: "7,220", barH: 24, barGrad: "linear-gradient(180deg,#FEF3C7,#D97706)", size: 44, fs: 14 },
              ].map((p, i) => (
                <div key={i} style={{ textAlign: "center", padding: 8 }}>
                  <div style={{ fontSize: 20, marginBottom: 5 }}>{p.medal}</div>
                  <div style={{ width: p.size, height: p.size, borderRadius: "50%", background: p.bg, color: p.fg, fontSize: p.fs, fontWeight: 600, margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", border: `3px solid ${p.borderCol}`, boxShadow: `0 0 0 3px ${p.glowBg}` }}>{p.id}</div>
                  <div style={{ fontSize: i === 1 ? 14 : 13, fontWeight: i === 1 ? 700 : 600, color: "var(--gray-900)" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{p.city}</div>
                  <div style={{ fontSize: i === 1 ? 18 : i === 0 ? 16 : 15, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--gray-900)", marginTop: 3 }}>{p.pts}</div>
                  <div style={{ height: p.barH, background: p.barGrad, borderRadius: "4px 4px 0 0", marginTop: 8, border: i === 1 ? "1px solid #FCD34D" : "none" }} />
                </div>
              ))}
            </div>
          </div>

          {/* Full leaderboard table */}
          <div className="cm-card">
            <div className="cm-lb-header"><div>Rank</div><div>Athlete</div><div>Score</div><div>Change</div><div /></div>
            {[
              { rank: "1", rc: "r1", id: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", detail: "Prague · 88.2 km · 7 acts", score: "9,840", trend: "↑+1", tc: "cm-trend-up", you: false },
              { rank: "2", rc: "r2", id: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", detail: "Tokyo · 68.0 km · 6 acts", score: "7,610", trend: "↑+2", tc: "cm-trend-up", you: false },
              { rank: "3", rc: "r3", id: "AL", bg: "#E0F2FE", fg: "#0369A1", name: "Alena L.", detail: "London · 71.4 km · 5 acts", score: "7,220", trend: "—", tc: "cm-trend-eq", you: false },
              { rank: "4", rc: "", id: "PR", bg: "#FBEAF0", fg: "#72243E", name: "Priya R.", detail: "Mumbai · 62.0 km · 5 acts", score: "6,980", trend: "↑+3", tc: "cm-trend-up", you: false },
              { rank: "5", rc: "", id: "JK", bg: "#FFF7ED", fg: "#9A3412", name: "Jamie K.", detail: "London · 12.4 km · 3 acts", score: "6,440", trend: "↑+3", tc: "cm-trend-up", you: true },
              { rank: "6", rc: "", id: "TR", bg: "#F5F3FF", fg: "#5B21B6", name: "Tom R.", detail: "London · 21.3 km · 4 acts", score: "5,880", trend: "↓−1", tc: "cm-trend-dn", you: false },
            ].map(r => (
              <div key={r.rank} className={`cm-lb-row ${r.you ? "you" : ""}`}>
                <div className={`cm-lb-rank ${r.rc}`}>{r.rank}</div>
                <div className="cm-lb-athlete">
                  <div className="cm-lb-av" style={{ background: r.bg, color: r.fg }}>{r.id}</div>
                  <div><div className="cm-lb-name">{r.name}</div><div className="cm-lb-detail">{r.detail}</div></div>
                </div>
                <div style={{ textAlign: "right" }}><div className="cm-lb-score">{r.score}</div><div className="cm-lb-score-sub">pts</div></div>
                <div><span className={`cm-trend ${r.tc}`}>{r.trend}</span></div>
                <div>{r.you && <span className="cm-you-tag">you</span>}</div>
              </div>
            ))}
            <div style={{ padding: "10px 16px", borderTop: "var(--border)", background: "var(--gray-50)", fontSize: 12, color: "var(--gray-500)", display: "flex", justifyContent: "space-between" }}>
              <span>Showing 6 of 48 members</span>
              <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => showToast("Loading full leaderboard…")}>Load all</Btn>
            </div>
          </div>
        </div>

        {/* ════ CHALLENGES ════ */}
        <div className={`cm-tab ${tab === "challenges" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Club challenges ⚡</h1><p>Private challenges — Hackney Running Club members only</p></div>
            <div className="cm-page-hdr-right">
              <Btn cls="cm-btn-yellow" onClick={() => setModal("challenge-browse")}>Browse all challenges</Btn>
            </div>
          </div>
          <div className="cm-grid-2">

            {/* 100km May Run */}
            <div className="cm-ch-card">
              <div className="cm-ch-head">
                <div className="cm-ch-icon" style={{ background: "#FFF7ED" }}>🏃</div>
                <div>
                  <div className="cm-ch-name">100km May Run</div>
                  <div className="cm-ch-meta">Distance · Community · 44 joined · 9 days left</div>
                  <div className="cm-ch-tags">
                    <span className="cm-pill cm-pill-run">Running</span>
                    <span className="cm-pill cm-pill-active">✓ Joined</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FAEEDA", color: "#633806", border: "1px solid #EF9F27" }}>+500 pts</span>
                  </div>
                </div>
              </div>
              <div className="cm-ch-body">
                <div className="cm-prog-label"><span>Your progress</span><span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--gray-900)" }}>62 / 100 km</span></div>
                <div className="cm-prog-track"><div className="cm-prog-fill" style={{ width: "62%", background: "#F97316" }} /></div>
                <div className="cm-prog-note">38 km remaining · ~4.2 km/day to finish · you're rank #5 of 44</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-700)", marginTop: 10, marginBottom: 5 }}>Your activity streak</div>
                <StreakDots dots={[1,1,1,3,1,1,1,2,0]} />
                <MiniLb rows={[
                  { rank: "1", id: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", score: "94.2 km" },
                  { rank: "2", id: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", score: "68.0 km" },
                  { rank: "5", id: "JK", bg: "#FFF7ED", fg: "#9A3412", name: "You", score: "62.4 km", isYou: true },
                ]} />
              </div>
              <div className="cm-ch-footer">
                <span className="cm-ch-days">9 days left · ends May 31</span>
                <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => nav("feed")}>Log activity →</Btn>
              </div>
            </div>

            {/* 7-day streak */}
            <div className="cm-ch-card">
              <div className="cm-ch-head">
                <div className="cm-ch-icon" style={{ background: "#F5F3FF" }}>🔥</div>
                <div>
                  <div className="cm-ch-name">Club 7-day streak</div>
                  <div className="cm-ch-meta">Streak · Private · 44 joined · Resets Monday</div>
                  <div className="cm-ch-tags">
                    <span className="cm-pill cm-pill-run">Running</span>
                    <span className="cm-pill cm-pill-active">✓ Joined</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FAEEDA", color: "#633806", border: "1px solid #EF9F27" }}>+100 pts/week</span>
                  </div>
                </div>
              </div>
              <div className="cm-ch-body">
                <div className="cm-prog-label"><span>Your current streak</span><span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--gray-900)" }}>6 / 7 days</span></div>
                <div className="cm-prog-track"><div className="cm-prog-fill" style={{ width: "86%", background: "#8B5CF6" }} /></div>
                <div className="cm-prog-note">Run today to complete this week's streak! Don't break it now.</div>
                <div className="cm-streak-row" style={{ marginTop: 8 }}>
                  {["M","T","W","T","F","S"].map((d,i) => <div key={i} className="cm-s-dot cm-sd-done">{d}</div>)}
                  <div className="cm-s-dot cm-sd-today">S</div>
                </div>
                <MiniLb rows={[
                  { rank: "1", id: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", score: "21 days" },
                  { rank: "3", id: "JK", bg: "#FFF7ED", fg: "#9A3412", name: "You", score: "6 days", isYou: true },
                ]} />
              </div>
              <div className="cm-ch-footer">
                <span className="cm-ch-days">Resets next Monday</span>
                <Btn cls="cm-btn-yellow cm-btn-sm" onClick={() => showToast("Opening activity log…")}>Log today's run</Btn>
              </div>
            </div>

            {/* Sub-25 5K */}
            <div className="cm-ch-card">
              <div className="cm-ch-head">
                <div className="cm-ch-icon" style={{ background: "#EFF6FF" }}>⚡</div>
                <div>
                  <div className="cm-ch-name">Sub-25 5K club</div>
                  <div className="cm-ch-meta">Performance · Open · 44 joined · Always open</div>
                  <div className="cm-ch-tags">
                    <span className="cm-pill cm-pill-run">Running</span>
                    <span className="cm-pill cm-pill-active">✓ Joined</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FAEEDA", color: "#633806", border: "1px solid #EF9F27" }}>+250 pts</span>
                  </div>
                </div>
              </div>
              <div className="cm-ch-body">
                <div style={{ background: "var(--gray-50)", border: "var(--border)", borderRadius: 7, padding: "12px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gray-700)", marginBottom: 3 }}>Your best 5K this month</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--gray-900)" }}>25:48</div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 2 }}>48 seconds to go — target: 24:59</div>
                  <div className="cm-prog-track" style={{ marginTop: 8 }}><div className="cm-prog-fill" style={{ width: "87%", background: "#3B82F6" }} /></div>
                </div>
                <MiniLb rows={[
                  { rank: "🥇", id: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", score: "24:12" },
                  { rank: "🥈", id: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", score: "24:44" },
                  { rank: "—", id: "JK", bg: "#FFF7ED", fg: "#9A3412", name: "You", score: "25:48 · not yet", isYou: true },
                ]} />
                <div style={{ background: "#FFF9E0", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#7a5c00", marginTop: 10 }}>
                  💡 Parkrun Saturday is your best shot — flat course, pacing groups, and 3 clubmates also targeting sub-25.
                </div>
              </div>
              <div className="cm-ch-footer">
                <span className="cm-ch-days">Always open · +250 pts on completion</span>
              </div>
            </div>

            {/* Browse more */}
            <div className="cm-ch-card" style={{ borderStyle: "dashed", background: "var(--gray-50)" }} onClick={() => setModal("challenge-browse")}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, textAlign: "center", padding: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--gray-700)", marginBottom: 4 }}>Browse more challenges</div>
                <div style={{ fontSize: 12, color: "var(--gray-500)" }}>Discover club-only and community challenges across all your sports</div>
              </div>
            </div>

          </div>
        </div>

        {/* ════ EVENTS ════ */}
        <div className={`cm-tab ${tab === "events" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Club events 📅</h1><p>Events organised by Hackney Running Club · Your coach notifies you of each one</p></div>
            <div className="cm-page-hdr-right">
              <Btn cls="cm-btn-ghost" onClick={() => showToast("Opening Arenas event directory…")}>🔍 Find more events</Btn>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Event 1 — London Half Marathon */}
            <div className="cm-ev-card">
              <div style={{ background: "#FFF7ED", padding: "6px 18px", borderBottom: "1px solid #FDBA74", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#9A3412" }}>📣 Your coach added you to this event — RSVP by Apr 6</span>
                <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "#9A3412" }}>8 days to decide</span>
              </div>
              <div className="cm-ev-head">
                <div className="cm-ev-date-box"><div className="ed">13</div><div className="em">Apr</div></div>
                <div className="cm-ev-info">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <div className="cm-ev-name">London Half Marathon</div>
                    <span className="cm-pill cm-pill-run">Running</span>
                  </div>
                  <div className="cm-ev-meta">📍 Blackheath, London · ⏱ 7:00 AM start · 13.1 miles</div>
                  <div className="cm-ev-meta" style={{ marginTop: 2 }}>💷 Entry fee: £45/member · Club covers registration admin</div>
                  <div className="cm-ev-tags">
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#166634", border: "1px solid #86EFAC" }}>34 clubmates going</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>8 pending response</span>
                  </div>
                </div>
              </div>
              <div className="cm-ev-coach-note">
                <div className="cm-ai-icon" style={{ background: "var(--yellow)" }}>RC</div>
                <div><strong>Coach Rachel:</strong> Great flat course — perfect for a PB attempt. We'll meet at the start village at 6:30 AM. If you're entering, use the club code HRC2026 for the group booking. Bring your club vest!</div>
              </div>
              <div className="cm-ev-rsvp-section">
                <div className="cm-ev-rsvp-title">Who's going</div>
                <div className="cm-rsvp-counts">
                  <div className="cm-rsvp-count"><div className="cm-rsvp-dot" style={{ background: "#10B981" }} /><span style={{ color: "#10B981", fontWeight: 600 }}>34 going</span></div>
                  <div className="cm-rsvp-count"><div className="cm-rsvp-dot" style={{ background: "#F97316" }} /><span style={{ color: "#F97316" }}>8 pending</span></div>
                  <div className="cm-rsvp-count"><div className="cm-rsvp-dot" style={{ background: "var(--gray-300)" }} /><span style={{ color: "var(--gray-500)" }}>6 declined</span></div>
                </div>
                <div className="cm-member-row">
                  <div className="cm-member-avs">
                    {[["#FEF9C3","#854D0E","SL"],["#FCE7F3","#9D174D","YT"],["#E0F2FE","#0369A1","AL"],["#FBEAF0","#72243E","PR"]].map(([bg,fg,id]) => (
                      <div key={id} className="cm-member-av" style={{ background: bg, color: fg }}>{id}</div>
                    ))}
                    <div className="cm-member-av" style={{ background: "var(--gray-100)", color: "var(--gray-500)", fontSize: 7 }}>+30</div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Sofia, Yuki, Alena, Priya and 30 more confirmed</span>
                </div>
              </div>
              <div className="cm-ev-footer">
                <div className="cm-ev-my-rsvp">Your RSVP: <strong style={{ color: rsvpHalf ? "#10B981" : "#F97316" }}>{rsvpHalf ? "✓ Going" : "Pending — respond by Apr 6"}</strong></div>
                <div className="cm-ev-rsvp-btns">
                  {rsvpHalf
                    ? <Btn cls="cm-btn-green cm-btn-sm">✓ Going</Btn>
                    : <Btn cls="cm-btn-yellow" onClick={() => { setRsvpHalf(true); showToast("✓ RSVP confirmed — Coach Rachel has been notified!"); }}>✓ I'm going</Btn>
                  }
                  <Btn cls="cm-btn-ghost" onClick={() => showToast("You declined — Rachel has been notified")}>Can't make it</Btn>
                  <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => setModal("event-detail")}>More info</Btn>
                </div>
              </div>
            </div>

            {/* Event 2 — Parkrun */}
            <div className="cm-ev-card">
              <div className="cm-ev-head">
                <div className="cm-ev-date-box" style={{ background: "var(--gray-100)" }}>
                  <div className="ed" style={{ color: "var(--gray-700)" }}>19</div>
                  <div className="em" style={{ color: "var(--gray-600)" }}>Apr</div>
                </div>
                <div className="cm-ev-info">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <div className="cm-ev-name">Saturday Parkrun Club Takeover</div>
                    <span className="cm-pill cm-pill-run">Running</span>
                    <span className="cm-pill cm-pill-active">Free</span>
                  </div>
                  <div className="cm-ev-meta">📍 Victoria Park, London · ⏱ 9:00 AM · Free · All paces welcome</div>
                  <div className="cm-ev-tags">
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#166634", border: "1px solid #86EFAC" }}>22 going</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>14 pending</span>
                  </div>
                </div>
              </div>
              <div className="cm-ev-coach-note">
                <div className="cm-ai-icon" style={{ background: "var(--yellow)" }}>RC</div>
                <div><strong>Coach Rachel:</strong> No registration needed — just show up in your club vest. We'll do a group photo at the finish. Great way to meet other members if you're new to HRC!</div>
              </div>
              <div className="cm-ev-footer">
                <div className="cm-ev-my-rsvp">Your RSVP: <strong style={{ color: "#10B981" }}>✓ Going</strong></div>
                <div className="cm-ev-rsvp-btns">
                  <Btn cls="cm-btn-green cm-btn-sm" onClick={() => showToast("Already confirmed — see you there!")}>✓ Going</Btn>
                  <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => showToast("Removed from going — Rachel notified")}>Change RSVP</Btn>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ════ MEMBERS ════ */}
        <div className={`cm-tab ${tab === "members" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Club members 👥</h1><p>48 members in Hackney Running Club · Follow to see their activities in your personal feed</p></div>
            <div className="cm-page-hdr-right">
              <input type="text" placeholder="Search members…" style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, outline: "none", width: 200 }} />
              <select style={{ padding: "7px 12px", border: "var(--border)", borderRadius: 7, fontSize: 13, background: "white", outline: "none", cursor: "pointer" }}>
                <option>All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option>
              </select>
            </div>
          </div>
          <div className="cm-mc-grid">
            {MEMBERS.map(m => (
              <div key={m.id} className="cm-mc">
                <div className="cm-mc-head">
                  <div className="cm-mc-av" style={{ background: m.bg, color: m.fg }}>{m.id}</div>
                  <div>
                    <div className="cm-mc-name">{m.name}</div>
                    <div className="cm-mc-handle">{m.handle}</div>
                    <div className="cm-mc-loc">📍 {m.loc}{m.role ? ` · ${m.role}` : ""}</div>
                  </div>
                </div>
                <div className="cm-mc-tags">
                  <span className="cm-pill cm-pill-run">Running</span>
                  <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FAEEDA", color: "#633806", border: "1px solid #EF9F27" }}>{m.level}</span>
                  {m.isCoach && <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#ECFDF5", color: "#166534", border: "1px solid #86EFAC" }}>Coach</span>}
                </div>
                <div className="cm-mc-stats">
                  {[[m.pts,"pts"],[m.km,"this wk"],[m.streak,"streak"]].map(([v,l]) => (
                    <div key={l} className="cm-mc-stat"><div className="msv">{v}</div><div className="msl">{l}</div></div>
                  ))}
                </div>
                <div className="cm-mc-footer">
                  <div className="cm-mc-streak">
                    {m.streakDots.map((d,i) => (
                      <div key={i} className="cm-mc-dot" style={{ background: d === 1 ? "#10B981" : d === 2 ? "var(--yellow)" : "var(--gray-200)" }} />
                    ))}
                  </div>
                  <FollowBtn id={m.id} />
                </div>
              </div>
            ))}

            {/* Jamie (you) */}
            <div className="cm-mc" style={{ background: "#FFFBEB", borderColor: "#fde68a" }}>
              <div className="cm-mc-head">
                <div className="cm-mc-av" style={{ background: "var(--yellow)", color: "var(--gray-900)" }}>JK</div>
                <div>
                  <div className="cm-mc-name">Jamie K. <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400 }}>(you)</span></div>
                  <div className="cm-mc-handle">@jamiek</div>
                  <div className="cm-mc-loc">📍 London, UK · Member</div>
                </div>
              </div>
              <div className="cm-mc-tags">
                <span className="cm-pill cm-pill-run">Running</span>
                <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: "#FAEEDA", color: "#633806", border: "1px solid #EF9F27" }}>Advanced</span>
              </div>
              <div className="cm-mc-stats">
                {[["6,440","pts"],["12km","this wk"],["#5","club rank"]].map(([v,l]) => (
                  <div key={l} className="cm-mc-stat"><div className="msv">{v}</div><div className="msl">{l}</div></div>
                ))}
              </div>
              <div className="cm-mc-footer">
                <div style={{ fontSize: 11, color: "#7a5c00" }}>Your profile</div>
                <Btn cls="cm-btn-ghost cm-btn-sm" onClick={() => setLocation("/profile")}>Edit profile</Btn>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Btn cls="cm-btn-ghost" onClick={() => showToast("Loading more members…")}>Load more members</Btn>
          </div>
        </div>

        {/* ════ NOTIFICATIONS ════ */}
        <div className={`cm-tab ${tab === "notifications" ? "active" : ""}`}>
          <div className="cm-page-hdr">
            <div><h1>Notifications 🔔</h1><p>Club updates, event invitations and challenge alerts</p></div>
            <div className="cm-page-hdr-right">
              <Btn cls="cm-btn-ghost" onClick={() => showToast("All marked as read")}>Mark all read</Btn>
            </div>
          </div>
          <div className="cm-card">
            {[
              {
                unread: true, iconBg: "#FFF7ED", icon: "📅",
                text: <><strong>Coach Rachel</strong> has invited you to the London Half Marathon on Apr 13. 34 clubmates are already going — RSVP by Apr 6.</>,
                actions: [
                  { label: "✓ I'm going", cls: "cm-btn-yellow", fn: () => { setRsvpHalf(true); showToast("✓ RSVP confirmed — Coach Rachel notified!"); } },
                  { label: "Can't make it", cls: "cm-btn-ghost", fn: () => showToast("You declined") },
                ],
                time: "2 hours ago · Club event",
              },
              {
                unread: true, iconBg: "#F5F3FF", icon: "⚡",
                text: <><strong>Club weekly streak</strong> — don't break it! You've run 6 days in a row. Log a run today to complete this week and earn 100 pts.</>,
                actions: [{ label: "Log a run →", cls: "cm-btn-primary", fn: () => showToast("Opening activity log…") }],
                time: "5 hours ago · Challenge",
              },
              {
                unread: true, iconBg: "#ECFDF5", icon: "🎉",
                text: <><strong>Alena L.</strong> from your club just completed the 100km May Run challenge — she's the first Hackney RC member to finish! Give her kudos.</>,
                actions: [{ label: "👍 Send kudos", cls: "cm-btn-ghost", fn: () => showToast("Kudos sent to Alena! 🎉") }],
                time: "1 day ago · Club challenge",
              },
              {
                unread: false, iconBg: "#FFF9E0", icon: "🏆",
                text: <>You moved up to <strong>rank #5</strong> on the Hackney RC leaderboard this week — up 3 places. Log one more run to overtake Priya R. for #4.</>,
                actions: [],
                time: "2 days ago · Leaderboard",
              },
              {
                unread: false, iconBg: "#EFF6FF", icon: "👋",
                text: <><strong>Welcome to Hackney Running Club!</strong> You've been added by coach Rachel H. Connect Strava to start logging activities and appear on the club leaderboard.</>,
                actions: [
                  { label: "Connect Strava →", cls: "cm-btn-primary", fn: () => showToast("Connecting Strava…") },
                  { label: "Meet the team", cls: "cm-btn-ghost", fn: () => nav("members") },
                ],
                time: "2 days ago · Club welcome",
              },
            ].map((n, i) => (
              <div key={i} className={`cm-notif-item ${n.unread ? "unread" : ""}`}>
                <div className="cm-notif-icon" style={{ background: n.iconBg }}>{n.icon}</div>
                <div className="cm-notif-content">
                  <div className="cm-notif-text">{n.text}</div>
                  {n.actions.length > 0 && (
                    <div className="cm-notif-action">
                      {n.actions.map((a, j) => (
                        <Btn key={j} cls={`${a.cls} cm-btn-sm`} onClick={a.fn}>{a.label}</Btn>
                      ))}
                    </div>
                  )}
                  <div className="cm-notif-time">{n.time}</div>
                </div>
                {n.unread && <div className="cm-unread-dot" />}
              </div>
            ))}
          </div>
        </div>

      </main>

      {/* ── MODALS ── */}
      {modal === "comment" && (
        <div className="cm-modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="cm-modal">
            <div className="cm-modal-hdr">
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--gray-900)" }}>Comments</div>
              <button className="cm-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="cm-modal-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { id: "YT", bg: "#FCE7F3", fg: "#9D174D", text: "Amazing effort Sofia! What's your fuelling strategy on long runs?" },
                  { id: "SL", bg: "#FEF9C3", fg: "#854D0E", text: "Thanks Yuki! Gel every 45 min, electrolytes at hour 2. Simple but works for me." },
                ].map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: c.bg, color: c.fg, fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.id}</div>
                    <div style={{ background: "var(--gray-50)", borderRadius: "0 10px 10px 10px", padding: "9px 12px", fontSize: 13, color: "var(--gray-700)" }}>{c.text}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 9, marginTop: 6 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#FFF7ED", color: "#9A3412", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>JK</div>
                <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a comment…" style={{ flex: 1, padding: "8px 12px", border: "var(--border)", borderRadius: 20, fontSize: 13, outline: "none" }} />
              </div>
            </div>
            <div className="cm-modal-footer">
              <Btn cls="cm-btn-primary" onClick={() => { setModal(null); setCommentText(""); showToast("Comment posted!"); }}>Post comment</Btn>
              <Btn cls="cm-btn-ghost" onClick={() => setModal(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {modal === "event-detail" && (
        <div className="cm-modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="cm-modal">
            <div className="cm-modal-hdr">
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74", padding: "2px 9px", borderRadius: 20, display: "inline-block", marginBottom: 8 }}>Running</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--gray-900)" }}>London Half Marathon</div>
                <div style={{ fontSize: 13, color: "var(--gray-500)", marginTop: 3 }}>Apr 13, 2026 · Blackheath, London</div>
              </div>
              <button className="cm-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="cm-modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Distance","13.1 mi"],["Start time","7:00 AM"],["Entry fee","£45"],["Clubmates going","34"]].map(([l,v]) => (
                  <div key={l} style={{ background: "var(--gray-50)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--gray-400)", marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--gray-900)", fontFamily: "var(--mono)" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--gray-500)", marginBottom: 8 }}>Coach notes</div>
                <p style={{ fontSize: 14, color: "var(--gray-600)", lineHeight: 1.65 }}>Great flat course — perfect for a PB attempt. We'll meet at the start village at 6:30 AM. If entering, use club code HRC2026 for group booking. Bring your club vest — we're aiming for a club photo at the finish line.</p>
              </div>
            </div>
            <div className="cm-modal-footer">
              <Btn cls="cm-btn-yellow" onClick={() => { setModal(null); setRsvpHalf(true); showToast("✓ RSVP confirmed — Rachel notified!"); }}>✓ I'm going</Btn>
              <Btn cls="cm-btn-ghost" onClick={() => setModal(null)}>Close</Btn>
            </div>
          </div>
        </div>
      )}

      {modal === "challenge-browse" && (
        <div className="cm-modal-bg" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="cm-modal">
            <div className="cm-modal-hdr">
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--gray-900)" }}>More club challenges</div>
                <div style={{ fontSize: 13, color: "var(--gray-500)", marginTop: 2 }}>Hackney Running Club · Private challenges</div>
              </div>
              <button className="cm-modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="cm-modal-body">
              {[
                { bg: "#ECFDF5", icon: "🏃", name: "June 200km club", meta: "Distance · Starts Jun 1 · 600 pts", btnCls: "cm-btn-primary", btnLabel: "+ Join", fn: () => { setModal(null); showToast("Joined June challenge!"); } },
                { bg: "#FEF2F2", icon: "⚔️", name: "Jamie vs Tom — weekly km", meta: "Head-to-head · Tom R. challenged you · 150 pts", btnCls: "cm-btn-yellow", btnLabel: "Accept", fn: () => { setModal(null); showToast("Joined head-to-head with Tom!"); } },
              ].map((c, i) => (
                <div key={i} style={{ background: "var(--gray-50)", border: "var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={c.fn}>
                  <div style={{ width: 38, height: 38, background: c.bg, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{c.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-900)" }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--gray-500)" }}>{c.meta}</div>
                  </div>
                  <Btn cls={`${c.btnCls} cm-btn-sm`} onClick={e => { e.stopPropagation(); c.fn(); }}>{c.btnLabel}</Btn>
                </div>
              ))}
            </div>
            <div className="cm-modal-footer">
              <Btn cls="cm-btn-ghost" onClick={() => setModal(null)}>Close</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`cm-toast ${toastVisible ? "show" : ""}`}>{toastMsg}</div>
    </div>
  );
}
