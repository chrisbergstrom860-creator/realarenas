import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

type Filter = "all" | "run" | "cyc" | "clm" | "clubs" | "ai";
type Modal = "comment" | "log-activity" | "notifications" | null;

const FILTER_LABELS: Record<Filter, string> = {
  all: "All", run: "🏃 Running", cyc: "🚴 Cycling",
  clm: "🧗 Climbing", clubs: "🤝 Clubs only", ai: "✦ AI insights",
};

const CARD_TYPES: Record<string, string> = {
  card1: "ai", card2: "run", card3: "clubs", card4: "cyc",
  card5: "all", card6: "all", card7: "all",
  card8: "clm", card9: "run", card10: "clubs", card11: "run",
};

export default function Feed() {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();

  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [rsvpHalf, setRsvpHalf] = useState(false);
  const [rsvpParkrun, setRsvpParkrun] = useState(false);

  const [kudos, setKudos] = useState<Record<string, { count: number; liked: boolean }>>({
    sofia2:  { count: 28, liked: true  },
    marco4:  { count: 14, liked: false },
    sofiaR8: { count: 41, liked: false },
    yuki9:   { count: 19, liked: false },
    alena11: { count: 31, liked: true  },
  });

  const [followStates, setFollowStates] = useState<Record<string, boolean>>({
    priya: false, marco: true, sofiaR: false,
  });

  const [aiPanel, setAiPanel] = useState<Record<string, boolean>>({
    marco4: false, yuki9: false,
  });

  const [commentText, setCommentText] = useState("");
  const [actName, setActName]   = useState("");
  const [actDist, setActDist]   = useState("");
  const [actDur, setActDur]     = useState("");
  const [actDate, setActDate]   = useState("");
  const [actDesc, setActDesc]   = useState("");

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2800);
  }, []);

  const toggleKudos = (key: string) => {
    setKudos(prev => {
      const cur = prev[key];
      return { ...prev, [key]: { count: cur.liked ? cur.count - 1 : cur.count + 1, liked: !cur.liked } };
    });
  };

  const toggleFollow = (key: string, name: string) => {
    setFollowStates(prev => {
      const now = !prev[key];
      showToast(now ? `Now following ${name}!` : `Unfollowed ${name}`);
      return { ...prev, [key]: now };
    });
  };

  const changeFilter = (f: Filter) => {
    setFilter(f);
    if (f !== "all") {
      const count = Object.values(CARD_TYPES).filter(t => t === f || t === "all").length;
      showToast(`Showing ${count} posts`);
    }
  };

  const isVisible = (type: string): boolean => {
    if (filter === "all") return true;
    return type === filter || type === "all";
  };

  const closeModal = () => setModal(null);

  return (
    <div className="fd-app">

      {/* ── TOAST ── */}
      <div className={`fd-toast${toastVisible ? " show" : ""}`}>{toast}</div>

      {/* ── TOPBAR ── */}
      <header className="fd-topbar">
        <div className="fd-topbar-logo">
          <div className="fd-logo-icon">🏟</div>
          <span className="fd-logo-text">Arenas</span>
        </div>
        <div className="fd-topbar-center">
          <div className="fd-search">
            <span style={{ color: "var(--fd-gray-400)", fontSize: 13 }}>🔍</span>
            <input type="text" placeholder="Search athletes, clubs, events…" />
          </div>
        </div>
        <div className="fd-topbar-actions">
          <div className="fd-notif-btn" onClick={() => setModal("notifications")}>
            🔔<div className="fd-notif-dot" />
          </div>
          <div className="fd-user-av" onClick={() => setLocation("/profile")}>JK</div>
        </div>
      </header>

      {/* ── LEFT SIDEBAR ── */}
      <aside className="fd-sidebar">
        <div className="fd-nav-label">My Arenas</div>
        <div className="fd-nav-item active"><span className="fd-nav-icon">🏠</span> Feed</div>
        <div className="fd-nav-item" onClick={() => setLocation("/profile")}><span className="fd-nav-icon">👤</span> My profile</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening events…")}><span className="fd-nav-icon">📅</span> Events</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening leaderboards…")}><span className="fd-nav-icon">🏆</span> Leaderboards</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening challenges…")}><span className="fd-nav-icon">⚡</span> Challenges <span className="fd-nav-badge">3</span></div>
        <div className="fd-nav-item" onClick={() => showToast("Opening athletes…")}><span className="fd-nav-icon">👥</span> Athletes</div>
        <div className="fd-nav-label">My clubs</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening club…")}><span className="fd-nav-icon">🏃</span> Hackney RC <span className="fd-nav-badge fd-badge-red">2</span></div>
        <div className="fd-nav-label">Account</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening settings…")}><span className="fd-nav-icon">⚙️</span> Settings</div>
        <div className="fd-nav-item" onClick={() => showToast("Opening billing…")}><span className="fd-nav-icon">💳</span> Pro plan</div>
        <div className="fd-sidebar-footer">
          <div className="fd-user-av" style={{ width: 30, height: 30, flexShrink: 0 }}>JK</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fd-gray-900)" }}>Jamie King</div>
            <div style={{ fontSize: 10, color: "var(--fd-gray-500)" }}>@jamiek · Pro</div>
          </div>
          <button
            style={{ marginLeft: "auto", padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "var(--fd-border)", background: "white", color: "var(--fd-gray-600)", cursor: "pointer" }}
            onClick={() => { logout(); setLocation("/"); }}
          >
            Log out
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="fd-main">

        {/* ─── FEED COLUMN ─── */}
        <div className="fd-feed-col">

          {/* Feed header */}
          <div className="fd-feed-header">
            <div className="fd-feed-header-top">
              <div className="fd-feed-title">Your feed</div>
              <div className="fd-live-badge"><div className="fd-live-dot" />Live · 312,841 activities</div>
            </div>
            <div className="fd-filter-bar">
              {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
                <div key={f} className={`fd-f-pill${filter === f ? " on" : ""}`} onClick={() => changeFilter(f)}>
                  {FILTER_LABELS[f]}
                </div>
              ))}
              <select className="fd-f-sort" onChange={() => showToast("Feed sorted")}>
                <option>Latest first</option>
                <option>Top kudos</option>
                <option>AI insights first</option>
                <option>Following only</option>
              </select>
            </div>
          </div>

          {/* Feed items */}
          <div className="fd-feed-items">

            {/* ── CARD 1: AI coaching nudge ── */}
            {!nudgeDismissed && isVisible("ai") && (
              <div className="fd-item-wrap">
                <div className="fd-ai-nudge">
                  <div className="fd-ai-nudge-inner">
                    <div className="fd-ai-orb">AI</div>
                    <div style={{ flex: 1 }}>
                      <div className="fd-ai-nudge-label">✦ Your AI coach · personalised for Jamie King</div>
                      <div className="fd-ai-nudge-text">
                        Your training load this week is <strong>42% above your 4-week average</strong> — a level that typically precedes fatigue or injury.
                        Based on your HR drift in yesterday's ride (avg 162 bpm vs your zone 3 target of 150), your body is asking for recovery.
                        A rest day today puts you in the best shape for Sunday's long run, and you're still fully on track for the London Marathon if you taper smartly from here.
                      </div>
                      <div className="fd-ai-actions">
                        <button className="fd-ai-btn primary" onClick={() => showToast("Rest day logged — great call!")}>Mark rest day →</button>
                        <button className="fd-ai-btn" onClick={() => showToast("Opening your load data…")}>See load data</button>
                        <button className="fd-ai-btn" onClick={() => { setNudgeDismissed(true); showToast("AI nudge dismissed"); }}>Dismiss</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── CARD 2: Sofia L. running (AI panel open) ── */}
            {isVisible("run") && (
              <div className="fd-item-wrap">
                <div className="fd-ac-body">
                  <div className="fd-ac-head">
                    <div className="fd-ac-av" style={{ background: "#FEF9C3", color: "#854D0E" }}>SL</div>
                    <div>
                      <div className="fd-ac-user-name" onClick={() => showToast("Opening Sofia's profile…")}>Sofia L.</div>
                      <div className="fd-ac-user-meta">34 min ago · London, UK · Hackney RC</div>
                    </div>
                    <div className="fd-sport-tag" style={{ background: "var(--fd-orange-light)", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                  </div>
                  <div className="fd-stats-row">
                    {[["18.2","km"],["1:20:04","time"],["4:24","/km"],["144","bpm"],["+610","elev m"],["782","kcal"]].map(([v,l]) => (
                      <div key={l} className="fd-stat"><span className="fd-sv">{v}</span><span className="fd-sl">{l}</span></div>
                    ))}
                  </div>
                  <div className="fd-ac-desc">Sunday progression long run done. Held 4:22 for the back half which felt really solid. That's 94.2km this month — going to break 100km before May 31 🎯</div>
                  <div className="fd-ai-panel">
                    <div className="fd-ai-panel-icon">AI</div>
                    <div className="fd-ai-panel-text"><strong>AI Coach:</strong> Negative split execution was excellent — second half avg 4:22 vs 4:26 first half. HR only rose 6 bpm across the whole run, which indicates very strong aerobic base. Full recovery recommended tomorrow before any intensity work. This is race-ready form.</div>
                  </div>
                </div>
                <div className="fd-ac-footer">
                  <button className={`fd-ac-action${kudos.sofia2.liked ? " liked" : ""}`} onClick={() => toggleKudos("sofia2")}>👍 {kudos.sofia2.count} kudos</button>
                  <button className="fd-ac-action" onClick={() => setModal("comment")}>💬 9 comments</button>
                  <button className="fd-ac-action" onClick={() => showToast("Route saved!")}>📍 Save route</button>
                  <div className="fd-ac-meta-right"><span className="fd-ai-tag">✦ AI</span> #1 Hackney RC</div>
                </div>
              </div>
            )}

            {/* ── CARD 3: Club update — RSVP ── */}
            {isVisible("clubs") && (
              <div className="fd-item-wrap">
                <div className="fd-cu-banner">
                  <div className="fd-cu-club-icon" style={{ background: "var(--fd-orange-light)" }}>🏃</div>
                  <span className="fd-cu-label">Hackney Running Club</span>
                  <span style={{ fontSize: 11, color: "var(--fd-gray-400)", marginLeft: "auto" }}>1h ago</span>
                </div>
                <div className="fd-cu-body">
                  <div className="fd-cu-title">London Half Marathon — RSVP closes in 8 days</div>
                  <div className="fd-cu-text">34 members confirmed, 8 still pending. <strong>Coach Rachel says:</strong> <em>"Meet at the start village 6:30 AM. Use club code HRC2026 for group booking. Bring your club vest — we're aiming for a group photo at the finish."</em></div>
                  <div className="fd-rsvp-bar">
                    <div style={{ width: "70%", background: "var(--fd-green)", height: "100%" }} />
                    <div style={{ width: "16%", background: "var(--fd-orange)", height: "100%" }} />
                  </div>
                  <div className="fd-cu-tags">
                    <span className="fd-pill fd-pill-green">34 going</span>
                    <span className="fd-pill fd-pill-run">8 pending</span>
                    {rsvpHalf
                      ? <span className="fd-pill fd-pill-green">Your RSVP: going ✓</span>
                      : <span className="fd-pill fd-pill-yellow">Your RSVP: pending</span>
                    }
                  </div>
                </div>
                <div className="fd-cu-footer">
                  {rsvpHalf ? (
                    <button className="fd-btn fd-btn-sm" style={{ background: "var(--fd-green-light)", color: "#166534", borderColor: "#86EFAC", cursor: "default" }} disabled>✓ Going</button>
                  ) : (
                    <button className="fd-btn fd-btn-yellow fd-btn-sm" onClick={() => { setRsvpHalf(true); showToast("RSVP confirmed — Rachel notified!"); }}>✓ I'm going</button>
                  )}
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Declined — Rachel notified")}>Can't make it</button>
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening event details…")}>More info →</button>
                </div>
              </div>
            )}

            {/* ── CARD 4: Marco C. cycling ── */}
            {isVisible("cyc") && (
              <div className="fd-item-wrap">
                <div className="fd-ac-body">
                  <div className="fd-ac-head">
                    <div className="fd-ac-av" style={{ background: "#FEF3C7", color: "#92400E" }}>MC</div>
                    <div>
                      <div className="fd-ac-user-name" onClick={() => showToast("Opening Marco's profile…")}>Marco C.</div>
                      <div className="fd-ac-user-meta">2h ago · Milan, IT</div>
                    </div>
                    <div className="fd-sport-tag" style={{ background: "var(--fd-blue-light)", color: "#1E40AF", border: "1px solid #93C5FD" }}>🚴 Cycling</div>
                  </div>
                  <div className="fd-stats-row">
                    {[["88","km"],["241","avg W"],["3.2","W/kg"],["1,240","elev m"],["3:02","time"]].map(([v,l]) => (
                      <div key={l} className="fd-stat"><span className="fd-sv">{v}</span><span className="fd-sl">{l}</span></div>
                    ))}
                  </div>
                  <div className="fd-ac-desc">Stelvio approach — held 241W normalised for the full climb which is a personal record by 18W. Saturday group ride open, DM to join. Cap 12 riders, 3 spots left.</div>
                  {aiPanel.marco4 && (
                    <div className="fd-ai-panel">
                      <div className="fd-ai-panel-icon">AI</div>
                      <div className="fd-ai-panel-text"><strong>AI Coach:</strong> 241W normalised over a 3-hour climb is exceptional — that puts you in the top 15% of comparable cyclists at this distance. Your pacing was very consistent with only a 3% power drop in the final 30 minutes. Excellent work.</div>
                    </div>
                  )}
                </div>
                <div className="fd-ac-footer">
                  <button className={`fd-ac-action${kudos.marco4.liked ? " liked" : ""}`} onClick={() => toggleKudos("marco4")}>👍 {kudos.marco4.count} kudos</button>
                  <button className="fd-ac-action" onClick={() => setModal("comment")}>💬 6 comments</button>
                  <button className="fd-ac-action" onClick={() => { setAiPanel(p => ({ ...p, marco4: true })); showToast("AI analysis loaded"); }}>✦ AI coach</button>
                  <div className="fd-ac-meta-right"><span className="fd-ai-tag">✦ AI</span></div>
                </div>
              </div>
            )}

            {/* ── CARD 5: Achievement — Alena ── */}
            {isVisible("all") && (
              <div className="fd-item-wrap">
                <div className="fd-ach-banner">🏅 Achievement unlocked — Hackney Running Club</div>
                <div className="fd-ach-body">
                  <div className="fd-ach-medal">🏅</div>
                  <div>
                    <div className="fd-ach-title">Alena L. completed the 100km May Run! First in the club.</div>
                    <div className="fd-ach-sub">Alena hit 104.2km — the first Hackney RC member to complete the May challenge. She earned 500 club points, the May Run badge, and moves to rank #3 on the all-time leaderboard. Who's next?</div>
                    <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                      <span className="fd-pill fd-pill-yellow">500 pts earned</span>
                      <span className="fd-pill fd-pill-green">↑ Rank #3 all time</span>
                    </div>
                  </div>
                </div>
                <div className="fd-ach-footer">
                  <button className="fd-btn fd-btn-yellow fd-btn-sm" onClick={() => showToast("🎉 Kudos sent to Alena!")}>🎉 Send kudos</button>
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening challenge page…")}>See full challenge →</button>
                </div>
              </div>
            )}

            {/* ── CARD 6: Challenge — your progress ── */}
            {isVisible("all") && (
              <div className="fd-item-wrap">
                <div className="fd-ch-body">
                  <div className="fd-ch-header">
                    <div>
                      <div className="fd-ch-name">⚡ 100km May Run — your progress</div>
                      <div style={{ fontSize: 12, color: "var(--fd-gray-500)", marginTop: 1 }}>Club challenge · 44 participants · private</div>
                    </div>
                    <div className="fd-ch-days">9 days left</div>
                  </div>
                  <div className="fd-prog-label">
                    <span>Your total</span>
                    <span style={{ fontFamily: "var(--fd-mono)", fontWeight: 600, color: "var(--fd-gray-900)" }}>62.4 / 100 km</span>
                  </div>
                  <div className="fd-prog-track"><div className="fd-prog-fill" style={{ width: "62%", background: "var(--fd-orange)" }} /></div>
                  <div className="fd-prog-note">4.2 km/day needed to finish · you're rank #5 of 44</div>
                  <div className="fd-ch-mini-lb">
                    <div className="fd-ch-lb-col"><div className="fd-ch-lb-rank">🥇 #1</div><div className="fd-ch-lb-val">104.2</div><div className="fd-ch-lb-name">Alena L.</div></div>
                    <div className="fd-ch-lb-col"><div className="fd-ch-lb-rank">#2</div><div className="fd-ch-lb-val">94.2</div><div className="fd-ch-lb-name">Sofia L.</div></div>
                    <div className="fd-ch-lb-col you"><div className="fd-ch-lb-rank">you · #5</div><div className="fd-ch-lb-val">62.4</div><div className="fd-ch-lb-name">Jamie K.</div></div>
                  </div>
                </div>
                <div className="fd-ch-footer">
                  <button className="fd-btn fd-btn-yellow fd-btn-sm" onClick={() => setModal("log-activity")}>Log a run →</button>
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening full challenge…")}>Full leaderboard</button>
                </div>
              </div>
            )}

            {/* ── CARD 7: Event discovery ── */}
            {isVisible("all") && (
              <div className="fd-item-wrap">
                <div className="fd-ev-rec-banner">📍 Recommended event · 2.4 km away · matches your sports</div>
                <div className="fd-ev-body">
                  <div className="fd-ev-date-box">
                    <div className="fd-ed">19</div>
                    <div className="fd-em">Apr</div>
                  </div>
                  <div className="fd-ev-info">
                    <div className="fd-ev-name">Victoria Park Parkrun — Hackney RC Takeover</div>
                    <div className="fd-ev-meta">Victoria Park, London · Free to enter · 9:00 AM start · 5km · All paces welcome</div>
                    <div className="fd-ev-tags">
                      <span className="fd-pill fd-pill-run">Running</span>
                      <span className="fd-pill fd-pill-green">22 clubmates going</span>
                      <span className="fd-pill fd-pill-yellow">Free</span>
                    </div>
                  </div>
                </div>
                <div className="fd-coach-note">
                  <strong>Coach Rachel's note:</strong> No registration — just show up in your club vest. We'll do a group photo at the finish. Great way to meet new members!
                </div>
                <div className="fd-ev-footer">
                  <div style={{ fontSize: 12, color: "var(--fd-gray-500)" }}>Coach Rachel organised · 22 members confirmed</div>
                  <div style={{ display: "flex", gap: 7 }}>
                    {rsvpParkrun ? (
                      <button className="fd-btn fd-btn-sm" style={{ background: "var(--fd-green-light)", color: "#166534", borderColor: "#86EFAC", cursor: "default" }} disabled>✓ Going</button>
                    ) : (
                      <button className="fd-btn fd-btn-yellow fd-btn-sm" onClick={() => { setRsvpParkrun(true); showToast("RSVP confirmed — see you there!"); }}>✓ I'm going</button>
                    )}
                    <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening event details…")}>More info</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── CARD 8: Sofia R. climbing (AI open) ── */}
            {isVisible("clm") && (
              <div className="fd-item-wrap">
                <div className="fd-ac-body">
                  <div className="fd-ac-head">
                    <div className="fd-ac-av" style={{ background: "#F5F3FF", color: "#5B21B6" }}>SR</div>
                    <div>
                      <div className="fd-ac-user-name" onClick={() => showToast("Opening Sofia R.'s profile…")}>Sofia R.</div>
                      <div className="fd-ac-user-meta">4h ago · Barcelona, ES</div>
                    </div>
                    <div className="fd-sport-tag" style={{ background: "var(--fd-purple-light)", color: "#5B21B6", border: "1px solid #C4B5FD" }}>🧗 Climbing</div>
                  </div>
                  <div className="fd-stats-row">
                    {[["V7","top grade"],["Sent ✓","status"],["3 wks","project"],["2h 30m","session"]].map(([v,l]) => (
                      <div key={l} className="fd-stat"><span className="fd-sv">{v}</span><span className="fd-sl">{l}</span></div>
                    ))}
                  </div>
                  <div className="fd-ac-desc">Finally sent the V7 at Montserrat after 3 weeks of projecting. The crux was the undercling sequence into the heel hook — will post beta video in comments for anyone working it.</div>
                  <div className="fd-ai-panel">
                    <div className="fd-ai-panel-icon">AI</div>
                    <div className="fd-ai-panel-text"><strong>AI Coach:</strong> Sending a 3-week project shows excellent mental persistence — the success rate on problems at this difficulty usually requires 4–6 sessions. Your session volume has been well-managed this cycle, which likely contributed to the send today.</div>
                  </div>
                </div>
                <div className="fd-ac-footer">
                  <button className={`fd-ac-action${kudos.sofiaR8.liked ? " liked" : ""}`} onClick={() => toggleKudos("sofiaR8")}>👍 {kudos.sofiaR8.count} kudos</button>
                  <button className="fd-ac-action" onClick={() => setModal("comment")}>💬 17 comments</button>
                  <button className="fd-ac-action" onClick={() => showToast("Activity link copied!")}>🔗 Share</button>
                  <div className="fd-ac-meta-right"><span className="fd-ai-tag">✦ AI</span></div>
                </div>
              </div>
            )}

            {/* ── CARD 9: Yuki T. running ── */}
            {isVisible("run") && (
              <div className="fd-item-wrap">
                <div className="fd-ac-body">
                  <div className="fd-ac-head">
                    <div className="fd-ac-av" style={{ background: "#FCE7F3", color: "#9D174D" }}>YT</div>
                    <div>
                      <div className="fd-ac-user-name" onClick={() => showToast("Opening Yuki's profile…")}>Yuki T.</div>
                      <div className="fd-ac-user-meta">5h ago · Tokyo, JP · Hackney RC</div>
                    </div>
                    <div className="fd-sport-tag" style={{ background: "var(--fd-orange-light)", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                  </div>
                  <div className="fd-stats-row">
                    {[["15.0","km"],["4:02","/km"],["171","bpm"],["60:30","time"]].map(([v,l]) => (
                      <div key={l} className="fd-stat"><span className="fd-sv">{v}</span><span className="fd-sl">{l}</span></div>
                    ))}
                  </div>
                  <div className="fd-ac-desc">Tempo block — 3×5km at 3:58/km with 3min jog recovery. Felt controlled throughout. Fitness is coming together ahead of the race.</div>
                  {aiPanel.yuki9 && (
                    <div className="fd-ai-panel">
                      <div className="fd-ai-panel-icon">AI</div>
                      <div className="fd-ai-panel-text"><strong>AI Coach:</strong> Tempo intervals at 3:58/km with 171 bpm avg shows excellent lactate threshold fitness. The 3-min jog recovery is appropriate for this intensity. Yuki's HR indicated similar drift to last week's session, suggesting good adaptation.</div>
                    </div>
                  )}
                </div>
                <div className="fd-ac-footer">
                  <button className={`fd-ac-action${kudos.yuki9.liked ? " liked" : ""}`} onClick={() => toggleKudos("yuki9")}>👍 {kudos.yuki9.count} kudos</button>
                  <button className="fd-ac-action" onClick={() => setModal("comment")}>💬 4 comments</button>
                  <button className="fd-ac-action" onClick={() => { setAiPanel(p => ({ ...p, yuki9: true })); showToast("AI analysis loaded"); }}>✦ AI coach</button>
                  <div className="fd-ac-meta-right"><span className="fd-ai-tag">✦ AI</span></div>
                </div>
              </div>
            )}

            {/* ── CARD 10: Club update — streak nudge ── */}
            {isVisible("clubs") && (
              <div className="fd-item-wrap">
                <div className="fd-cu-banner">
                  <div className="fd-cu-club-icon" style={{ background: "var(--fd-orange-light)" }}>🏃</div>
                  <span className="fd-cu-label">Hackney Running Club · Challenge update</span>
                  <span style={{ fontSize: 11, color: "var(--fd-gray-400)", marginLeft: "auto" }}>6h ago</span>
                </div>
                <div className="fd-cu-body">
                  <div className="fd-cu-title">⚡ 7-day streak — 5 members at risk of breaking it</div>
                  <div className="fd-cu-text">Omar B., Tom R., and 3 others haven't logged an activity in the last 48 hours. Today is the last day to keep the streak alive and earn this week's 100 points.</div>
                  <div className="fd-cu-tags">
                    <span className="fd-pill fd-pill-run">39 on streak</span>
                    <span className="fd-pill" style={{ background: "var(--fd-red-light)", color: "#A32D2D", borderColor: "#FECACA" }}>5 at risk</span>
                  </div>
                </div>
                <div className="fd-cu-footer">
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Nudge sent to 5 at-risk members!")}>📢 Nudge teammates</button>
                  <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening challenge…")}>View leaderboard →</button>
                </div>
              </div>
            )}

            {/* ── CARD 11: Alena L. running ── */}
            {isVisible("run") && (
              <div className="fd-item-wrap">
                <div className="fd-ac-body">
                  <div className="fd-ac-head">
                    <div className="fd-ac-av" style={{ background: "#E0F2FE", color: "#0369A1" }}>AL</div>
                    <div>
                      <div className="fd-ac-user-name" onClick={() => showToast("Opening Alena's profile…")}>Alena L.</div>
                      <div className="fd-ac-user-meta">8h ago · London, UK · Hackney RC</div>
                    </div>
                    <div className="fd-sport-tag" style={{ background: "var(--fd-orange-light)", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                  </div>
                  <div className="fd-stats-row">
                    {[["71.4","km"],["4:30","/km"],["138","bpm"],["5:21","total"]].map(([v,l]) => (
                      <div key={l} className="fd-stat"><span className="fd-sv">{v}</span><span className="fd-sl">{l}</span></div>
                    ))}
                  </div>
                  <div className="fd-ac-desc">Week 3 of marathon build — biggest week yet and it felt manageable. The Arenas AI coach flagged my HR drift on Wednesday which saved me from going too hard. 100km May Run done ✓ thanks Hackney RC for the motivation!</div>
                </div>
                <div className="fd-ac-footer">
                  <button className={`fd-ac-action${kudos.alena11.liked ? " liked" : ""}`} onClick={() => toggleKudos("alena11")}>👍 {kudos.alena11.count} kudos</button>
                  <button className="fd-ac-action" onClick={() => setModal("comment")}>💬 14 comments</button>
                  <button className="fd-ac-action" onClick={() => showToast("Activity link copied!")}>🔗 Share</button>
                  <div className="fd-ac-meta-right"><span className="fd-ai-tag">✦ AI</span> ⚡ Challenge done!</div>
                </div>
              </div>
            )}

            {/* Load more */}
            <div className="fd-load-more">
              <button className="fd-load-more-btn" onClick={() => showToast("Loading more activities…")}>Load more activities</button>
            </div>

          </div>
        </div>

        {/* ─── RIGHT SIDE COLUMN ─── */}
        <div className="fd-side-col">

          {/* Your week */}
          <div className="fd-side-card">
            <div className="fd-side-hdr">
              <span className="fd-side-title">📊 Your week</span>
              <span style={{ fontSize: 11, fontFamily: "var(--fd-mono)", color: "var(--fd-gray-400)" }}>May 15–22</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "var(--fd-border)" }}>
              <div style={{ padding: "12px 14px", borderRight: "var(--fd-border)", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--fd-mono)", color: "var(--fd-gray-900)" }}>12.4</div>
                <div style={{ fontSize: 10, color: "var(--fd-gray-500)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 }}>km this week</div>
                <div style={{ fontSize: 10, color: "var(--fd-green)", fontFamily: "var(--fd-mono)", marginTop: 2 }}>↑ +3.2 vs last</div>
              </div>
              <div style={{ padding: "12px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--fd-mono)", color: "var(--fd-gray-900)" }}>#5</div>
                <div style={{ fontSize: 10, color: "var(--fd-gray-500)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 }}>Club rank</div>
                <div style={{ fontSize: 10, color: "var(--fd-green)", fontFamily: "var(--fd-mono)", marginTop: 2 }}>↑ +3 this week</div>
              </div>
            </div>
            <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--fd-gray-600)" }}>540 pts to overtake Priya R. for rank #4 — log one more run today.</div>
          </div>

          {/* Leaderboard */}
          <div className="fd-side-card">
            <div className="fd-side-hdr">
              <span className="fd-side-title">🏆 Hackney RC · this week</span>
              <button className="fd-btn fd-btn-sm" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => showToast("Opening full leaderboard…")}>Full →</button>
            </div>
            {[
              { rank: "1", rankCls: "r1", av: "AL", bg: "#E0F2FE", fg: "#0369A1", name: "Alena L.", pts: "7,220", trend: "↑+3", tCls: "up" },
              { rank: "2", rankCls: "r2", av: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", pts: "9,840", trend: "—",   tCls: "eq" },
              { rank: "3", rankCls: "r3", av: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", pts: "7,610", trend: "↑+2", tCls: "up" },
              { rank: "4", rankCls: "",   av: "PR", bg: "#FBEAF0", fg: "#72243E", name: "Priya R.", pts: "6,980", trend: "↓−1", tCls: "dn" },
            ].map(r => (
              <div key={r.rank} className="fd-lb-row">
                <span className={`fd-lb-rank${r.rankCls ? " " + r.rankCls : ""}`}>{r.rank}</span>
                <div className="fd-lb-av" style={{ background: r.bg, color: r.fg }}>{r.av}</div>
                <span className="fd-lb-name">{r.name}</span>
                <span className="fd-lb-pts">{r.pts}</span>
                <span className={`fd-lb-trend fd-lt-${r.tCls}`}>{r.trend}</span>
              </div>
            ))}
            <div className="fd-lb-row you">
              <span className="fd-lb-rank">5</span>
              <div className="fd-lb-av" style={{ background: "var(--fd-yellow)", color: "var(--fd-gray-900)" }}>JK</div>
              <span className="fd-lb-name">You</span>
              <span className="fd-lb-pts">6,440</span>
              <span className="fd-you-tag">you</span>
            </div>
            <div style={{ padding: "8px 14px 12px", borderTop: "var(--fd-border)", fontSize: 11, color: "var(--fd-gray-500)" }}>540 pts to rank #4 · you moved up 3 places this week 🚀</div>
          </div>

          {/* Streak */}
          <div className="fd-side-card">
            <div className="fd-side-hdr">
              <span className="fd-side-title">🔥 Activity streak</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--fd-mono)", color: "var(--fd-orange)" }}>6 days</span>
            </div>
            <div className="fd-streak-days">
              {[
                { label: "M", cls: "on",    title: "Mon — ran 8.2km" },
                { label: "T", cls: "on",    title: "Tue — rode 34km" },
                { label: "W", cls: "on",    title: "Wed — ran 5km" },
                { label: "T", cls: "miss",  title: "Thu — missed" },
                { label: "F", cls: "on",    title: "Fri — climbed 2hrs" },
                { label: "S", cls: "on",    title: "Sat — ran 12.4km" },
                { label: "S", cls: "today", title: "Today — log something!" },
              ].map((d, i) => (
                <div key={i} className={`fd-s-dot fd-sd-${d.cls}`} title={d.title}>{d.label}</div>
              ))}
            </div>
            <div style={{ padding: "0 14px 12px", fontSize: 12, color: "var(--fd-orange)", fontWeight: 500 }}>
              Log something today to keep the streak alive — and complete your 7-day club challenge!
            </div>
          </div>

          {/* Who to follow */}
          <div className="fd-side-card">
            <div className="fd-side-hdr"><span className="fd-side-title">👥 Athletes to follow</span></div>
            {[
              { key: "priya",  av: "PR", bg: "#FBEAF0", fg: "#72243E", name: "Priya R.",  meta: "Running · Hackney RC · rank #4" },
              { key: "marco",  av: "MC", bg: "#FEF3C7", fg: "#92400E", name: "Marco C.",  meta: "Cycling · Milan · similar pace" },
              { key: "sofiaR", av: "SR", bg: "#F5F3FF", fg: "#5B21B6", name: "Sofia R.", meta: "Climbing · Barcelona · V7 climber" },
            ].map(p => (
              <div key={p.key} className="fd-follow-item">
                <div className="fd-fi-av" style={{ background: p.bg, color: p.fg }}>{p.av}</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-fi-name">{p.name}</div>
                  <div className="fd-fi-meta">{p.meta}</div>
                </div>
                <button
                  className={`fd-follow-btn${followStates[p.key] ? " following" : ""}`}
                  onClick={() => toggleFollow(p.key, p.name)}
                >
                  {followStates[p.key] ? "Following" : "Follow"}
                </button>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="fd-side-card">
            <div className="fd-side-hdr"><span className="fd-side-title">⚡ Quick actions</span></div>
            {[
              { icon: "📝", bg: "var(--fd-orange-light)", title: "Log an activity",   sub: "Keep your streak alive · 6 days", action: () => setModal("log-activity") },
              { icon: "⚡", bg: "var(--fd-yellow-light)", title: "View challenges",    sub: "3 active · rank #5 in 100km",    action: () => showToast("Opening challenges…") },
              { icon: "📅", bg: "var(--fd-blue-light)",   title: "Upcoming events",   sub: "London Half · Apr 13",           action: () => showToast("Opening events…") },
              { icon: "✦", bg: "var(--fd-yellow-light)", title: "AI coach insights",  sub: "Rest day recommended today",     action: () => showToast("Opening AI coaching…") },
            ].map(qa => (
              <div key={qa.title} className="fd-qa-item" onClick={qa.action}>
                <div className="fd-qa-icon" style={{ background: qa.bg }}>{qa.icon}</div>
                <div><div className="fd-qa-title">{qa.title}</div><div className="fd-qa-sub">{qa.sub}</div></div>
                <span style={{ fontSize: 12, color: "var(--fd-gray-300)" }}>→</span>
              </div>
            ))}
          </div>

          {/* Trending topics */}
          <div className="fd-side-card">
            <div className="fd-side-hdr"><span className="fd-side-title">🔥 Trending topics</span></div>
            {[
              { emoji: "🏃", tag: "#LondonHalf",    count: "2.4k posts" },
              { emoji: "⚡", tag: "#MayRun100km",   count: "840 posts"  },
              { emoji: "🧗", tag: "#MontserratV7",  count: "312 posts"  },
              { emoji: "❤️", tag: "#ZoneTwo",        count: "1.1k posts" },
            ].map(t => (
              <div key={t.tag} className="fd-topic-item" onClick={() => showToast(`Filtering by ${t.tag}…`)}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{t.emoji}</span>
                <span className="fd-topic-tag">{t.tag}</span>
                <span className="fd-topic-count">{t.count}</span>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── MODAL: COMMENTS ── */}
      {modal === "comment" && (
        <div className="fd-modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="fd-modal">
            <div className="fd-modal-header">
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fd-gray-900)" }}>Comments</div>
              <button className="fd-modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="fd-modal-body">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div className="fd-comment-av" style={{ background: "#FEF9C3", color: "#854D0E" }}>SL</div>
                  <div className="fd-comment-bubble fd-comment-other">Great effort! What's your fuelling strategy for long runs over 15km? I've been struggling with energy at the 12km mark.</div>
                </div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div className="fd-comment-av" style={{ background: "#FFF7ED", color: "#9A3412" }}>JK</div>
                  <div className="fd-comment-bubble fd-comment-me">Thanks Sofia! Gel every 45 min starting at km 8, electrolytes at km 12. Keeps the energy stable right to the end. Try the AI coach — it flagged my exact same issue last month!</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 9, alignItems: "center", paddingTop: 4, borderTop: "var(--fd-border)" }}>
                <div className="fd-comment-av" style={{ background: "var(--fd-yellow)", color: "var(--fd-gray-900)" }}>JK</div>
                <input
                  type="text"
                  placeholder="Add a comment…"
                  className="fd-form-input"
                  style={{ flex: 1, borderRadius: 20 }}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                />
              </div>
            </div>
            <div className="fd-modal-footer">
              <button className="fd-btn fd-btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => { closeModal(); setCommentText(""); showToast("Comment posted!"); }}>Post comment</button>
              <button className="fd-btn" onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: LOG ACTIVITY ── */}
      {modal === "log-activity" && (
        <div className="fd-modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="fd-modal">
            <div className="fd-modal-header">
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fd-gray-900)" }}>Log an activity</div>
                <div style={{ fontSize: 13, color: "var(--fd-gray-500)", marginTop: 2 }}>Or connect Strava to sync automatically</div>
              </div>
              <button className="fd-modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="fd-modal-body">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="fd-btn fd-btn-sm" style={{ background: "var(--fd-orange-light)", color: "#9A3412", borderColor: "#FDBA74" }} onClick={() => showToast("Opening run log…")}>🏃 Run</button>
                <button className="fd-btn fd-btn-sm" style={{ background: "var(--fd-blue-light)", color: "#1E40AF", borderColor: "#93C5FD" }} onClick={() => showToast("Opening ride log…")}>🚴 Ride</button>
                <button className="fd-btn fd-btn-sm" style={{ background: "var(--fd-purple-light)", color: "#5B21B6", borderColor: "#C4B5FD" }} onClick={() => showToast("Opening climb log…")}>🧗 Climb</button>
                <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening walk log…")}>🚶 Walk</button>
                <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening swim log…")}>🏊 Swim</button>
                <button className="fd-btn fd-btn-sm" onClick={() => showToast("Opening gym log…")}>🏋️ Gym</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label className="fd-form-label">Activity name</label><input className="fd-form-input" type="text" placeholder="Morning run" value={actName} onChange={e => setActName(e.target.value)} /></div>
                <div><label className="fd-form-label">Distance (km)</label><input className="fd-form-input" type="number" placeholder="0.0" value={actDist} onChange={e => setActDist(e.target.value)} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label className="fd-form-label">Duration</label><input className="fd-form-input" type="text" placeholder="00:00:00" value={actDur} onChange={e => setActDur(e.target.value)} /></div>
                <div><label className="fd-form-label">Date &amp; time</label><input className="fd-form-input" type="datetime-local" value={actDate} onChange={e => setActDate(e.target.value)} /></div>
              </div>
              <div>
                <label className="fd-form-label">Description <span style={{ fontWeight: 400, color: "var(--fd-gray-400)" }}>(optional)</span></label>
                <textarea className="fd-form-textarea" placeholder="How did it feel? What did you learn?" value={actDesc} onChange={e => setActDesc(e.target.value)} />
              </div>
              <div className="fd-ai-callout">✦ The AI Coach will automatically analyse your activity and add insights after you log it.</div>
            </div>
            <div className="fd-modal-footer">
              <button className="fd-btn fd-btn-yellow" style={{ flex: 1, justifyContent: "center" }} onClick={() => { closeModal(); setActName(""); setActDist(""); setActDur(""); setActDate(""); setActDesc(""); showToast("✓ Activity logged — AI coaching on the way!"); }}>Log activity</button>
              <button className="fd-btn" onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: NOTIFICATIONS ── */}
      {modal === "notifications" && (
        <div className="fd-modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="fd-modal">
            <div className="fd-modal-header">
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fd-gray-900)" }}>Notifications</div>
              <button className="fd-modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="fd-modal-body" style={{ padding: 0, gap: 0 }}>
              <div className="fd-notif-item" style={{ background: "var(--fd-yellow-light)" }}>
                <div className="fd-notif-icon" style={{ background: "var(--fd-orange-light)" }}>📅</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-notif-title">Coach Rachel invited you to London Half Marathon</div>
                  <div className="fd-notif-sub">RSVP by Apr 6 · 34 clubmates going</div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button className="fd-btn fd-btn-sm fd-btn-yellow" onClick={() => { closeModal(); showToast("✓ Going!"); }}>Going</button>
                  <button className="fd-btn fd-btn-sm" onClick={closeModal}>No</button>
                </div>
              </div>
              <div className="fd-notif-item">
                <div className="fd-notif-icon" style={{ background: "var(--fd-purple-light)" }}>⚡</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-notif-title">7-day streak at risk — log something today</div>
                  <div className="fd-notif-sub">Challenge ends Monday · 100 pts at stake</div>
                </div>
                <button className="fd-btn fd-btn-sm fd-btn-yellow" onClick={() => setModal("log-activity")}>Log now</button>
              </div>
              <div className="fd-notif-item">
                <div className="fd-notif-icon" style={{ background: "var(--fd-yellow-light)" }}>🎉</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-notif-title">Alena L. completed the 100km challenge!</div>
                  <div className="fd-notif-sub">First in Hackney RC · send her kudos</div>
                </div>
                <button className="fd-btn fd-btn-sm" onClick={() => { closeModal(); showToast("🎉 Kudos sent!"); }}>👍 Kudos</button>
              </div>
              <div className="fd-notif-item">
                <div className="fd-notif-icon" style={{ background: "var(--fd-green-light)" }}>↑</div>
                <div style={{ flex: 1 }}>
                  <div className="fd-notif-title">You moved to rank #5 on Hackney RC</div>
                  <div className="fd-notif-sub">Up 3 places this week · 540 pts to #4</div>
                </div>
              </div>
              <div className="fd-notif-item">
                <div className="fd-notif-icon" style={{ background: "var(--fd-orange-light)" }}>👍</div>
                <div>
                  <div className="fd-notif-title">Sofia L. and 5 others gave kudos on your run</div>
                  <div className="fd-notif-sub">Today · 6 kudos · 3 comments</div>
                </div>
              </div>
            </div>
            <div className="fd-modal-footer">
              <button className="fd-btn" style={{ flex: 1, justifyContent: "center" }} onClick={closeModal}>Mark all read</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
