import { useState } from "react";
import Topbar from "@/components/Topbar";
import Footer from "@/components/Footer";

// ── TYPES ──
type Tab = "mine" | "discover" | "friends" | "completed";
type SportFilter = "all" | "running" | "cycling" | "climbing";
type TypeFilter = "all" | "solo" | "community" | "performance";

// ── DISCOVER DATA ──
const DISCOVER = [
  { id: "d1", sport: "running" as const, icon: "🏃", iconBg: "#FFF7ED", name: "5K every day in June",         sub: "Running · Daily streak · Community",      tags: ["Running", "Community"],    pts: 600, joined: 212,  start: "Starts Jun 1",  desc: "Run at least 5km every day in June. All paces welcome — treadmill counts. The community shares daily check-ins.",                                                                  type: "community"   as const },
  { id: "d2", sport: "cycling" as const, icon: "🚴", iconBg: "#EFF6FF", name: "1,000 km summer",              sub: "Cycling · Distance · Community",          tags: ["Cycling", "Community"],    pts: 800, joined: 88,   start: "Starts Jun 1",  desc: "Ride 1,000 km between June and August. Indoor and outdoor rides both count. Perfect for Granfondo prep.",                                                                    type: "community"   as const },
  { id: "d3", sport: "climbing"as const, icon: "🧗", iconBg: "#F5F3FF", name: "Project a V7 in 30 days",      sub: "Climbing · Grade · Solo",                tags: ["Climbing", "Solo"],         pts: 400, joined: 34,   start: "Join anytime",  desc: "Send your first V7 within 30 days of joining. Log your sessions — AI coach tracks your beta progress session by session.",                                                  type: "solo"        as const },
  { id: "d4", sport: "running" as const, icon: "🏃", iconBg: "#FFF7ED", name: "Sub-25 5K club",               sub: "Running · Performance · Community",       tags: ["Running", "Performance"],  pts: 250, joined: 1200, start: "Always open",   desc: "Log a verified sub-25 minute 5K at any race or parkrun. Community celebrates every milestone with kudos.",                                                                  type: "performance" as const },
  { id: "d5", sport: "cycling" as const, icon: "🚴", iconBg: "#EFF6FF", name: "Morning rides — 30 days",      sub: "Cycling · Streak · Solo",                tags: ["Cycling", "Solo"],          pts: 300, joined: 56,   start: "Join anytime",  desc: "Complete a ride before 9am on 20 of the next 30 days. Syncs automatically from Strava and Garmin.",                                                                          type: "solo"        as const },
  { id: "d6", sport: "running" as const, icon: "🏃", iconBg: "#FFF7ED", name: "Half marathon prep — 8 weeks", sub: "Running · Distance · Community",          tags: ["Running", "Community"],    pts: 500, joined: 144,  start: "Starts Jun 1",  desc: "Follow an 8-week structured programme building to half marathon distance. Weekly targets set by the community coach.",                                                      type: "community"   as const },
];

const TAG_CLS: Record<string, string> = {
  Running: "ch-tag-run", Cycling: "ch-tag-cyc", Climbing: "ch-tag-clm",
  Community: "ch-tag-com", Solo: "ch-tag-solo", Performance: "ch-tag-pts",
  "Head-to-head": "ch-tag-h2h",
};

// ── ACTIVITY LOG ──
type DayStatus = "done" | "miss" | "today" | "fut";
const ACTIVITY_LOG: DayStatus[] = [
  "done","done","done","miss","done","done","done",
  "done","done","miss","done","done","done","done",
  "today","fut","fut","fut","fut","fut","fut",
];

function Tag({ label }: { label: string }) {
  return <span className={`ch-tag ${TAG_CLS[label] || "ch-tag-solo"}`}>{label}</span>;
}

function StreakDay({ status, label }: { status: DayStatus; label: string | number }) {
  const cls = { done: "ch-s-done", miss: "ch-s-miss", today: "ch-s-today", fut: "ch-s-fut" }[status];
  return <div className={`ch-s-day ${cls}`}>{label}</div>;
}

export default function Challenges() {
  const [tab, setTab] = useState<Tab>("mine");
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [joinedDiscover, setJoinedDiscover] = useState<Set<string>>(new Set());
  const [cycJoined, setCycJoined] = useState(true);
  const [clmJoined, setClmJoined] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState("dist");
  const [createSport, setCreateSport] = useState("running");
  const [createName, setCreateName] = useState("");
  const [createTarget, setCreateTarget] = useState("");
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  function toggleDiscover(id: string) {
    const next = new Set(joinedDiscover);
    if (next.has(id)) { next.delete(id); showToast("Left challenge"); }
    else { next.add(id); showToast("Joined! Good luck 💪"); }
    setJoinedDiscover(next);
  }

  const filteredDiscover = DISCOVER.filter(c =>
    (sportFilter === "all" || c.sport === sportFilter) &&
    (typeFilter === "all" || c.type === typeFilter)
  );

  return (
    <div>
      <Topbar loggedIn={false} activeNav="Challenges" />

      {/* Page header */}
      <div className="chl-page-header">
        <div className="chl-page-header-inner">
          <div className="chl-header-left">
            <h1>Challenges 🏆</h1>
            <p>Personalised to your sports — Running, Cycling & Climbing. Earn points, beat friends, hit milestones.</p>
            <div className="chl-header-stats">
              <div className="chl-header-stat"><div className="chl-stat-dot" style={{ background: "#10B981" }} /><strong>3</strong> active challenges</div>
              <div className="chl-header-stat"><div className="chl-stat-dot" style={{ background: "#FFD21E" }} /><strong>1,240</strong> pts earned this month</div>
              <div className="chl-header-stat"><div className="chl-stat-dot" style={{ background: "#3B82F6" }} /><strong>340</strong> challenges available</div>
              <div className="chl-header-stat"><div className="chl-stat-dot" style={{ background: "#8B5CF6" }} /><strong>14</strong> day longest streak</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexShrink: 0, marginTop: 4 }}>
            <button className="btn btn-yellow" onClick={() => setCreateOpen(true)} data-testid="btn-create-challenge">+ Create challenge</button>
          </div>
        </div>
      </div>

      {/* Tabs bar */}
      <div className="chl-tabs-bar">
        <div className="chl-tabs-inner">
          {([ ["mine","My challenges","3"], ["discover","Discover","340"], ["friends","With friends","1"], ["completed","Completed","7"] ] as [Tab,string,string][]).map(([key, label, count]) => (
            <button
              key={key}
              className={`chl-main-tab${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
              data-testid={`tab-${key}`}
            >
              {label} <span className="chl-tab-count">{count}</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
        </div>
      </div>

      {/* Main */}
      <main className="chl-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ═══ MY CHALLENGES ═══ */}
          {tab === "mine" && (
            <>
              <div className="chl-stat-cards">
                {[
                  { label: "Active challenges", value: "3",     sub: "Across 3 sports",      delta: null },
                  { label: "Points this month",  value: "1,240", sub: null,                   delta: "↑ +340 this week" },
                  { label: "Current streak",     value: "6",     sub: "days · best: 14",      delta: null },
                  { label: "Challenges won",     value: "4",     sub: "of 7 completed",       delta: null },
                ].map(s => (
                  <div key={s.label} className="chl-stat-card">
                    <div className="chl-sc-label">{s.label}</div>
                    <div className="chl-sc-value">{s.value}</div>
                    {s.sub   && <div className="chl-sc-sub">{s.sub}</div>}
                    {s.delta && <div className="chl-sc-delta">{s.delta}</div>}
                  </div>
                ))}
              </div>

              {/* Featured: 100km May Run */}
              <div className="chl-card chl-featured" data-testid="card-100km-run">
                <div className="chl-featured-banner">
                  <div className="chl-featured-banner-left">⭐ Featured — ends in 9 days</div>
                  <div className="chl-featured-banner-right">
                    <Tag label="Running" /><Tag label="Community" />
                  </div>
                </div>
                <div className="chl-ch-head">
                  <div className="chl-ch-sport-icon" style={{ background: "#FFF7ED" }}>🏃</div>
                  <div className="chl-ch-info">
                    <div className="chl-ch-name">100km May Run</div>
                    <div className="chl-ch-sub">Running · Distance challenge · Community · May 2026</div>
                    <div className="chl-ch-tags">
                      <Tag label="Running" />
                      <span className="ch-tag ch-tag-com">✓ Joined</span>
                      <span className="ch-tag ch-tag-pts">+500 pts</span>
                    </div>
                  </div>
                </div>
                <div className="chl-ch-progress">
                  <div className="chl-prog-header">
                    <span className="chl-prog-label">Your progress</span>
                    <span className="chl-prog-value">62 / 100 km</span>
                  </div>
                  <div className="chl-prog-track"><div className="chl-prog-fill" style={{ width: "62%", background: "#F97316" }} /></div>
                  <div className="chl-prog-note">
                    <span>38 km remaining — ~4.2 km/day to finish on time</span>
                    <span>Rank #5 of 44</span>
                  </div>
                </div>
                <div className="chl-streak-wrap">
                  <div className="chl-streak-title">Your activity log this month</div>
                  <div className="chl-streak-grid">
                    {ACTIVITY_LOG.map((s, i) => <StreakDay key={i} status={s} label={i + 1} />)}
                  </div>
                </div>
                {/* Mini leaderboard */}
                <div className="chl-ch-lb">
                  <div className="chl-ch-lb-title">Challenge leaderboard</div>
                  {[
                    { rank: 1,  init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  loc: "Prague", score: "94.2 km", trend: "up",  isYou: false },
                    { rank: 2,  init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  loc: "London", score: "88.1 km", trend: "eq",  isYou: false },
                    { rank: 3,  init: "TR", bg: "#F5F3FF", c: "#5B21B6", name: "Tom R.",    loc: "London", score: "76.4 km", trend: "up",  isYou: false },
                    { rank: 4,  init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   loc: "Tokyo",  score: "71.0 km", trend: "dn",  isYou: false },
                    { rank: 5,  init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  loc: "London", score: "62.4 km", trend: "up",  isYou: true  },
                    { rank: 6,  init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",   loc: "Dubai",  score: "58.9 km", trend: "dn",  isYou: false },
                  ].map(r => (
                    <div key={r.rank} className={`chl-lb-row${r.isYou ? " is-you" : ""}`}>
                      <span className={`chl-lb-rank${r.rank <= 3 ? ` r${r.rank}` : ""}`}>{r.rank}</span>
                      <div className="chl-lb-av" style={{ background: r.bg, color: r.c }}>{r.init}</div>
                      <div className="chl-lb-name">{r.name} <span className="chl-lb-loc">· {r.loc}</span></div>
                      <span className="chl-lb-score" style={r.isYou ? { color: "#D97706", fontWeight: 700 } : {}}>{r.score}</span>
                      <span className={`chl-trend chl-trend-${r.trend}`}>{r.trend === "up" ? "↑ +1" : r.trend === "dn" ? "↓ −1" : "—"}</span>
                      {r.isYou && <span className="chl-you-tag">you</span>}
                    </div>
                  ))}
                </div>
                <div className="chl-ch-footer">
                  <div className="chl-ch-footer-left">
                    <div className="chl-att-avs">
                      {[["#FEF9C3","#854D0E","SL"],["#E0F2FE","#0369A1","AL"],["#F5F3FF","#5B21B6","TR"],["#FCE7F3","#9D174D","YT"]].map(([bg,c,i]) => (
                        <div key={i} className="chl-att-av" style={{ background: bg, color: c }}>{i}</div>
                      ))}
                      <div className="chl-att-av" style={{ background: "var(--gray-100)", color: "var(--gray-500)", fontSize: 8 }}>+40</div>
                    </div>
                    <span className="chl-att-count">44 athletes joined</span>
                  </div>
                  <div className="chl-ch-footer-right">
                    <span className="chl-days-left">9 days left</span>
                    <button className="chl-join-btn joined" onClick={e => e.stopPropagation()}>✓ Joined</button>
                  </div>
                </div>
              </div>

              {/* 2-col: Cycling + Climbing */}
              <div className="chl-cards-grid-2">
                {/* Cycling Century */}
                <div className="chl-card">
                  <div className="chl-ch-head">
                    <div className="chl-ch-sport-icon" style={{ background: "#EFF6FF" }}>🚴</div>
                    <div className="chl-ch-info">
                      <div className="chl-ch-name">Cycling Century</div>
                      <div className="chl-ch-sub">Cycling · Distance · Solo · May 2026</div>
                      <div className="chl-ch-tags"><Tag label="Cycling" /><Tag label="Solo" /><span className="ch-tag ch-tag-pts">+350 pts</span></div>
                    </div>
                  </div>
                  <div className="chl-ch-desc-wrap">
                    <div className="chl-ch-desc">Ride 100 miles in a single calendar month. Indoor and outdoor rides both count. One of Arenas' most popular solo targets.</div>
                  </div>
                  <div className="chl-ch-progress">
                    <div className="chl-prog-header">
                      <span className="chl-prog-label">Progress</span>
                      <span className="chl-prog-value">88 / 100 mi</span>
                    </div>
                    <div className="chl-prog-track"><div className="chl-prog-fill" style={{ width: "88%", background: "#3B82F6" }} /></div>
                    <div className="chl-prog-note">
                      <span>12 mi remaining — just one ride away</span>
                      <span style={{ color: "#10B981", fontWeight: 600 }}>Almost there!</span>
                    </div>
                  </div>
                  <div className="chl-ch-footer">
                    <span className="chl-days-left">21 days left</span>
                    <button
                      className={`chl-join-btn${cycJoined ? " leave" : ""}`}
                      onClick={e => { e.stopPropagation(); if (cycJoined) { setCycJoined(false); showToast("Left Cycling Century"); } }}
                    >{cycJoined ? "✓ Joined" : "+ Join"}</button>
                  </div>
                </div>

                {/* V6+ send streak */}
                <div className="chl-card">
                  <div className="chl-ch-head">
                    <div className="chl-ch-sport-icon" style={{ background: "#F5F3FF" }}>🧗</div>
                    <div className="chl-ch-info">
                      <div className="chl-ch-name">V6+ send streak</div>
                      <div className="chl-ch-sub">Climbing · Session streak · Solo · Ongoing</div>
                      <div className="chl-ch-tags"><Tag label="Climbing" /><Tag label="Solo" /><span className="ch-tag ch-tag-pts">+200 pts</span></div>
                    </div>
                  </div>
                  <div className="chl-ch-desc-wrap">
                    <div className="chl-ch-desc">Send at least one V6 or harder problem in 5 separate climbing sessions. Tracks your grade progression over time.</div>
                  </div>
                  <div className="chl-ch-progress">
                    <div className="chl-prog-header">
                      <span className="chl-prog-label">Progress</span>
                      <span className="chl-prog-value">3 / 5 sessions</span>
                    </div>
                    <div className="chl-prog-track"><div className="chl-prog-fill" style={{ width: "60%", background: "#8B5CF6" }} /></div>
                    <div className="chl-prog-note"><span>2 sessions remaining — ongoing</span></div>
                  </div>
                  <div className="chl-streak-wrap" style={{ paddingTop: 0 }}>
                    <div className="chl-streak-title">Session log</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {["done","done","done","fut","fut"].map((s, i) => (
                        <div key={i} className={`ch-s-day ${s === "done" ? "ch-s-done" : "ch-s-fut"}`} style={{ width: 32, height: 32, fontSize: 11, borderRadius: 7 }}>
                          {s === "done" ? "✓" : i + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="chl-ch-footer">
                    <span className="chl-days-left">Ongoing</span>
                    <button
                      className={`chl-join-btn${clmJoined ? " leave" : ""}`}
                      onClick={e => { e.stopPropagation(); if (clmJoined) { setClmJoined(false); showToast("Left V6+ send streak"); } }}
                    >{clmJoined ? "✓ Joined" : "+ Join"}</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ═══ DISCOVER ═══ */}
          {tab === "discover" && (
            <>
              <div className="chl-filter-bar">
                <span className="chl-filter-label">Sport:</span>
                {(["all","running","cycling","climbing"] as SportFilter[]).map(s => (
                  <button
                    key={s}
                    className={`chl-sport-filter${sportFilter === s ? " active" : ""}`}
                    onClick={() => setSportFilter(s)}
                  >{s === "all" ? "All my sports" : s === "running" ? "🏃 Running" : s === "cycling" ? "🚴 Cycling" : "🧗 Climbing"}</button>
                ))}
                <div className="chl-filter-divider" />
                {(["all","solo","community","performance"] as TypeFilter[]).map(t => (
                  <button
                    key={t}
                    className={`chl-difficulty-filter${typeFilter === t ? " active" : ""}`}
                    onClick={() => setTypeFilter(t)}
                  >{t === "all" ? "All types" : t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              <div className="chl-cards-grid-2" style={{ marginTop: 4 }}>
                {filteredDiscover.map(c => {
                  const joined = joinedDiscover.has(c.id);
                  return (
                    <div key={c.id} className="chl-card">
                      <div className="chl-ch-head">
                        <div className="chl-ch-sport-icon" style={{ background: c.iconBg }}>{c.icon}</div>
                        <div className="chl-ch-info">
                          <div className="chl-ch-name">{c.name}</div>
                          <div className="chl-ch-sub">{c.sub}</div>
                          <div className="chl-ch-tags">
                            {c.tags.map(t => <Tag key={t} label={t} />)}
                            <span className="ch-tag ch-tag-pts">+{c.pts} pts</span>
                            {joined && <span className="ch-tag ch-tag-new">✓ Joined</span>}
                          </div>
                        </div>
                      </div>
                      <div className="chl-ch-desc-wrap"><div className="chl-ch-desc">{c.desc}</div></div>
                      <div className="chl-ch-footer">
                        <div className="chl-ch-footer-left">
                          <span className="chl-att-count">{c.joined.toLocaleString()} joined · {c.start}</span>
                        </div>
                        <div className="chl-ch-footer-right">
                          <button
                            className={`chl-join-btn${joined ? " joined" : ""}`}
                            onClick={() => toggleDiscover(c.id)}
                          >{joined ? "✓ Joined" : "+ Join"}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredDiscover.length === 0 && (
                  <div className="chl-empty-state" style={{ gridColumn: "1 / -1" }}>
                    <div className="chl-empty-icon">🔍</div>
                    <h3>No challenges found</h3>
                    <p>Try changing the sport or type filter above.</p>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => showToast("Loading more challenges…")}>Load more challenges</button>
              </div>
            </>
          )}

          {/* ═══ WITH FRIENDS ═══ */}
          {tab === "friends" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* H2H card */}
              <div className="chl-h2h-card">
                <div className="chl-ch-head" style={{ borderBottom: "var(--border)" }}>
                  <div className="chl-ch-sport-icon" style={{ background: "#FFF7ED" }}>🏃</div>
                  <div className="chl-ch-info">
                    <div className="chl-ch-name">Jamie vs Tom — weekly km</div>
                    <div className="chl-ch-sub">Running · Head-to-head · Resets every Monday</div>
                    <div className="chl-ch-tags"><Tag label="Running" /><Tag label="Head-to-head" /><span className="ch-tag ch-tag-pts">+150 pts</span></div>
                  </div>
                </div>
                <div className="chl-h2h-body">
                  <div className="chl-h2h-player">
                    <div className="chl-h2h-av" style={{ background: "#FFF7ED", color: "#9A3412" }}>JK</div>
                    <div className="chl-h2h-name">You</div>
                    <div className="chl-h2h-score" style={{ color: "#F97316" }}>24.8</div>
                    <div className="chl-h2h-unit">km this week</div>
                  </div>
                  <div className="chl-h2h-vs">vs</div>
                  <div className="chl-h2h-player">
                    <div className="chl-h2h-av" style={{ background: "#F0FDF4", color: "#166534" }}>TR</div>
                    <div className="chl-h2h-name">Tom R.</div>
                    <div className="chl-h2h-score" style={{ color: "var(--gray-400)" }}>21.3</div>
                    <div className="chl-h2h-unit">km this week</div>
                  </div>
                </div>
                <div className="chl-h2h-progress">
                  <div className="chl-h2h-bar-wrap">
                    <div className="chl-h2h-bar-fill" style={{ width: "54%", background: "#F97316" }} />
                  </div>
                  <div className="chl-h2h-labels">
                    <span style={{ color: "#F97316", fontWeight: 600 }}>You're leading by 3.5 km</span>
                    <span>7 days left · resets Monday</span>
                  </div>
                </div>
                <div className="chl-ch-footer" style={{ borderTop: "var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--gray-500)" }}>Tom logged a 5.2km run yesterday</span>
                  <button className="chl-join-btn" onClick={() => showToast("Trash talk sent to Tom! 🗣️")}>💬 Trash talk</button>
                </div>
              </div>
              {/* Empty */}
              <div className="chl-empty-state">
                <div className="chl-empty-icon">🤝</div>
                <h3>Challenge more friends</h3>
                <p>Go head-to-head across any of your sports — distance, pace, or activity count. Your friends get a notification.</p>
                <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ Start a head-to-head</button>
              </div>
            </div>
          )}

          {/* ═══ COMPLETED ═══ */}
          {tab === "completed" && (
            <>
              <div className="chl-stat-cards" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                {[
                  { label: "Challenges completed", value: "7",     sub: "Since joining Arenas", delta: null },
                  { label: "Total points earned",  value: "3,250", sub: null,                   delta: "↑ All time" },
                  { label: "Win rate",             value: "57%",   sub: "4 of 7 placed top 3",  delta: null },
                ].map(s => (
                  <div key={s.label} className="chl-stat-card">
                    <div className="chl-sc-label">{s.label}</div>
                    <div className="chl-sc-value">{s.value}</div>
                    {s.sub   && <div className="chl-sc-sub">{s.sub}</div>}
                    {s.delta && <div className="chl-sc-delta">{s.delta}</div>}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { medal: "🥇", name: "100km April Run",           detail: "Running · Completed Apr 28, 2026 · 106.2 km logged · Rank #2 of 38",              pts: "+500 pts" },
                  { medal: "🥈", name: "Cycling 500km — Q1",        detail: "Cycling · Completed Mar 31, 2026 · 512 km logged · Rank #5 of 62",                pts: "+300 pts" },
                  { medal: "🏅", name: "14-day run streak",         detail: "Running · Completed Feb 14, 2026 · 14 consecutive days · Solo",                   pts: "+200 pts" },
                  { medal: "🥉", name: "First V6 send",             detail: "Climbing · Completed Jan 22, 2026 · Fontainebleau · Solo",                         pts: "+150 pts" },
                  { medal: "🏅", name: "5K under 25 min",           detail: "Running · Completed Dec 9, 2025 · Parkrun London · Performance",                   pts: "+250 pts" },
                  { medal: "🏅", name: "November cycling 300km",    detail: "Cycling · Completed Nov 30, 2025 · 318 km logged · Community",                    pts: "+300 pts" },
                  { medal: "🏅", name: "100 activities milestone",  detail: "All sports · Completed Oct 14, 2025 · Lifetime achievement",                      pts: "+250 pts" },
                ].map(c => (
                  <div key={c.name} className="chl-completed-card">
                    <div className="chl-comp-medal">{c.medal}</div>
                    <div className="chl-comp-info">
                      <div className="chl-comp-name">{c.name}</div>
                      <div className="chl-comp-detail">{c.detail}</div>
                    </div>
                    <div className="chl-comp-pts">{c.pts}</div>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>

        {/* Right sidebar */}
        <div className="chl-right-col">

          {/* Points breakdown */}
          <div className="chl-side-card">
            <div className="chl-side-title">Points breakdown — May</div>
            {[
              { dot: "#F97316", label: "Running",  val: "680 pts"   },
              { dot: "#3B82F6", label: "Cycling",  val: "410 pts"   },
              { dot: "#8B5CF6", label: "Climbing", val: "150 pts"   },
            ].map(r => (
              <div key={r.label} className="chl-pts-row">
                <div className="chl-pts-sport"><div className="chl-pts-sport-dot" style={{ background: r.dot }} />{r.label}</div>
                <span className="chl-pts-val">{r.val}</span>
              </div>
            ))}
            <div className="chl-pts-total">
              <span style={{ color: "var(--gray-600)" }}>Total this month</span>
              <strong>1,240 pts</strong>
            </div>
          </div>

          {/* Suggested */}
          <div className="chl-side-card">
            <div className="chl-side-title">Suggested for you</div>
            {[
              { icon: "🏃", bg: "#FFF7ED", name: "5K every day in June",      meta: "Running · Starts Jun 1 · 212 joined",     pts: "+600" },
              { icon: "🚴", bg: "#EFF6FF", name: "1,000 km summer",           meta: "Cycling · Jun–Aug · 88 joined",           pts: "+800" },
              { icon: "🧗", bg: "#F5F3FF", name: "Project a V7 in 30 days",   meta: "Climbing · Join anytime · 34 joined",     pts: "+400" },
              { icon: "🏃", bg: "#FFF7ED", name: "Sub-25 5K club",            meta: "Running · Always open · 1.2k joined",     pts: "+250" },
            ].map(s => (
              <div key={s.name} className="chl-sug-row" onClick={() => { setTab("discover"); showToast(`Showing ${s.name}`); }}>
                <div className="chl-sug-icon" style={{ background: s.bg }}>{s.icon}</div>
                <div className="chl-sug-info">
                  <div className="chl-sug-name">{s.name}</div>
                  <div className="chl-sug-meta">{s.meta}</div>
                </div>
                <span className="chl-sug-pts">{s.pts}</span>
              </div>
            ))}
            <div style={{ padding: "10px 16px" }}>
              <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 13 }} onClick={() => setTab("discover")}>Browse all challenges →</button>
            </div>
          </div>

          {/* Friends */}
          <div className="chl-side-card">
            <div className="chl-side-title">Friends in challenges</div>
            {[
              { init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  action: "Leading 100km May Run — 94.2 km",          time: "2h ago" },
              { init: "TR", bg: "#F0FDF4", c: "#166534", name: "Tom R.",    action: "Logged 5.2 km — head-to-head with you",     time: "5h ago" },
              { init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.", action: "Joined 5K every day in June",               time: "1d ago" },
              { init: "AM", bg: "#ECFDF5", c: "#065F46", name: "Alena M.", action: "Completed V7 send — Project a V7 done",     time: "2d ago" },
            ].map(f => (
              <div key={f.init} className="chl-friend-row">
                <div className="chl-fr-av" style={{ background: f.bg, color: f.c }}>{f.init}</div>
                <div className="chl-fr-info">
                  <div className="chl-fr-name">{f.name}</div>
                  <div className="chl-fr-action">{f.action}</div>
                </div>
                <span className="chl-fr-time">{f.time}</span>
              </div>
            ))}
          </div>

          {/* Streak */}
          <div className="chl-side-card">
            <div className="chl-side-title">Your streak — May</div>
            <div style={{ padding: "12px 16px 16px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--mono)", color: "var(--gray-900)", marginBottom: 2 }}>
                6 <span style={{ fontSize: 15, fontWeight: 400, color: "var(--gray-500)" }}>days</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 14 }}>Current streak · best: 14 days</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
                {["M","T","W","T","F","S","S"].map((d, i) => (
                  <div key={i} style={{ textAlign: "center", fontSize: 10, color: "var(--gray-400)" }}>{d}</div>
                ))}
                {(["done","done","done","miss","done","done","done","done","done","miss","done","done","done","today"] as DayStatus[]).map((s, i) => (
                  <div
                    key={i}
                    className={`ch-s-day ${{ done: "ch-s-done", miss: "ch-s-miss", today: "ch-s-today", fut: "ch-s-fut" }[s]}`}
                    style={{ width: "100%", aspectRatio: "1" }}
                  >
                    {s === "done" ? "✓" : s === "miss" ? "✗" : "T"}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--gray-500)", marginTop: 10 }}>Log an activity today to extend your streak to 7 days.</div>
            </div>
          </div>

        </div>
      </main>

      {/* ═══ CREATE CHALLENGE MODAL ═══ */}
      {createOpen && (
        <div className="chl-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <div className="chl-modal" onClick={e => e.stopPropagation()}>
            <div className="chl-modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--gray-900)" }}>Create a challenge</div>
                <div style={{ fontSize: 13, color: "var(--gray-500)", marginTop: 3 }}>Set the rules — invite friends or open to the community</div>
              </div>
              <button className="chl-modal-close" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div className="chl-modal-body">
              {/* Sport */}
              <div>
                <div className="chl-modal-section-label">Sport</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["running","🏃 Running"],["cycling","🚴 Cycling"],["climbing","🧗 Climbing"]].map(([key, label]) => (
                    <button
                      key={key}
                      className={`chl-sport-filter${createSport === key ? " active" : ""}`}
                      onClick={() => setCreateSport(key)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              {/* Type */}
              <div>
                <div className="chl-modal-section-label">Challenge type</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { key: "dist",   icon: "📏", label: "Distance",       sub: "Total km or miles" },
                    { key: "streak", icon: "🔥", label: "Streak",         sub: "Consecutive days" },
                    { key: "perf",   icon: "⚡", label: "Performance",    sub: "Hit a target pace or grade" },
                    { key: "h2h",   icon: "⚔️", label: "Head-to-head",   sub: "1v1 with a friend" },
                  ].map(t => (
                    <div
                      key={t.key}
                      onClick={() => setCreateType(t.key)}
                      style={{ padding: 12, border: createType === t.key ? "2px solid var(--gray-900)" : "var(--border)", borderRadius: "var(--radius)", cursor: "pointer", background: createType === t.key ? "var(--gray-50)" : "white" }}
                    >
                      <div style={{ fontSize: 15, marginBottom: 4 }}>{t.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: createType === t.key ? "var(--gray-900)" : "var(--gray-800)" }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{t.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Name */}
              <div>
                <label className="chl-modal-section-label" style={{ display: "block" }}>Challenge name</label>
                <input
                  type="text"
                  placeholder="e.g. May 100km Running Challenge"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", border: "var(--border)", borderRadius: "var(--radius)", fontSize: 14, fontFamily: "var(--font)", outline: "none", color: "var(--gray-800)" }}
                />
              </div>
              {/* Target + Duration */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label className="chl-modal-section-label" style={{ display: "block" }}>Target</label>
                  <input
                    type="text"
                    placeholder="e.g. 100 km"
                    value={createTarget}
                    onChange={e => setCreateTarget(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "var(--border)", borderRadius: "var(--radius)", fontSize: 14, fontFamily: "var(--font)", outline: "none", color: "var(--gray-800)" }}
                  />
                </div>
                <div>
                  <label className="chl-modal-section-label" style={{ display: "block" }}>Duration</label>
                  <select style={{ width: "100%", padding: "9px 12px", border: "var(--border)", borderRadius: "var(--radius)", fontSize: 14, fontFamily: "var(--font)", outline: "none", color: "var(--gray-700)", background: "white" }}>
                    <option>1 week</option>
                    <option>2 weeks</option>
                    <option selected>1 month</option>
                    <option>3 months</option>
                    <option>Ongoing</option>
                  </select>
                </div>
              </div>
              {/* Visibility */}
              <div>
                <div className="chl-modal-section-label">Visibility</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Community (public)","Friends only","Solo (private)"].map(v => (
                    <button key={v} className="chl-difficulty-filter" onClick={() => showToast(`${v} mode selected`)}>{v}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="chl-modal-footer">
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => {
                  if (!createName.trim()) { showToast("Please enter a challenge name"); return; }
                  setCreateOpen(false);
                  showToast("Challenge created! 🎉");
                  setCreateName(""); setCreateTarget("");
                }}
              >Create challenge</button>
              <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`chl-toast${toastVisible ? " show" : ""}`}>{toast}</div>

      <Footer />
    </div>
  );
}
