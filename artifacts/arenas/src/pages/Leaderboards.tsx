import { useState } from "react";
import Topbar from "@/components/Topbar";
import Footer from "@/components/Footer";

// ── DATA ──
const sportMeta: Record<string, { icon: string; iconBg: string; label: string; metrics: string[] }> = {
  all:      { icon: "🏅", iconBg: "#FFF9E0", label: "All my sports",  metrics: ["Points", "Activities", "Streak"] },
  running:  { icon: "🏃", iconBg: "#FFF7ED", label: "Running",        metrics: ["Points", "Distance", "Pace", "Activities"] },
  cycling:  { icon: "🚴", iconBg: "#EFF6FF", label: "Cycling",        metrics: ["Points", "Distance", "Avg Watts", "Activities"] },
  climbing: { icon: "🧗", iconBg: "#F5F3FF", label: "Climbing",       metrics: ["Points", "Grade", "Sessions", "Streak"] },
};

interface PodiumEntry { init: string; bg: string; c: string; name: string; loc: string; score: string; stat: string; rank: "gold" | "silver" | "bronze"; isYou?: boolean; }
interface LbRow { rank: number; init: string; bg: string; c: string; name: string; sub: string; score: string; pct: number; trend: "up" | "dn" | "eq"; isYou: boolean; }
interface Banner { rank: string; pts: string; acts: string; progressLabel: string; progressFrac: string; fill: number; next: string; sportLabel: string; }
interface LbData { banner: Banner; podium: PodiumEntry[]; rows: LbRow[]; }

const leaderboards: Record<string, LbData> = {
  all: {
    banner: { rank: "#4", pts: "16,980", acts: "8", progressLabel: "Progress to rank #3", progressFrac: "16,980 / 18,410", fill: 92, next: "1,430 pts to overtake Alena L. — log one more ride to get there.", sportLabel: "Running · Cycling · Climbing · Advanced" },
    podium: [
      { init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  loc: "Prague", score: "24,660", stat: "Running + Cycling",  rank: "gold"   },
      { init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.",  loc: "Milan",  score: "21,330", stat: "Cycling + Running",  rank: "silver" },
      { init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  loc: "London", score: "18,410", stat: "Running + Climbing", rank: "bronze" },
    ],
    rows: [
      { rank: 1, init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  sub: "Prague · 3 sports",  score: "24,660", pct: 100, trend: "up", isYou: false },
      { rank: 2, init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.",  sub: "Milan · 2 sports",   score: "21,330", pct: 86,  trend: "up", isYou: false },
      { rank: 3, init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  sub: "London · 2 sports",  score: "18,410", pct: 75,  trend: "dn", isYou: false },
      { rank: 4, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  sub: "London · 3 sports",  score: "16,980", pct: 69,  trend: "up", isYou: true  },
      { rank: 5, init: "TR", bg: "#F0FDF4", c: "#166534", name: "Tom R.",    sub: "London · 2 sports",  score: "14,760", pct: 60,  trend: "eq", isYou: false },
      { rank: 6, init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",   sub: "Dubai · 2 sports",   score: "13,440", pct: 54,  trend: "dn", isYou: false },
      { rank: 7, init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   sub: "Tokyo · 2 sports",   score: "12,110", pct: 49,  trend: "up", isYou: false },
      { rank: 8, init: "PR", bg: "#FBEAF0", c: "#9D174D", name: "Priya R.",  sub: "Mumbai · 3 sports",  score: "10,880", pct: 44,  trend: "eq", isYou: false },
    ],
  },
  running: {
    banner: { rank: "#5", pts: "6,440", acts: "3", progressLabel: "Progress to rank #4", progressFrac: "6,440 / 6,980", fill: 85, next: "540 pts to overtake Priya R. — one solid long run does it.", sportLabel: "Running · Advanced · 12.4 km this week" },
    podium: [
      { init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  loc: "Prague", score: "9,840", stat: "88.2 km", rank: "gold"   },
      { init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  loc: "London", score: "7,610", stat: "71.4 km", rank: "silver" },
      { init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   loc: "Tokyo",  score: "7,610", stat: "68.0 km", rank: "bronze" },
    ],
    rows: [
      { rank: 1, init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  sub: "Prague · 88.2 km",  score: "9,840", pct: 100, trend: "up", isYou: false },
      { rank: 2, init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  sub: "London · 71.4 km",  score: "7,610", pct: 77,  trend: "dn", isYou: false },
      { rank: 3, init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   sub: "Tokyo · 68.0 km",   score: "7,610", pct: 77,  trend: "up", isYou: false },
      { rank: 4, init: "PR", bg: "#FBEAF0", c: "#9D174D", name: "Priya R.",  sub: "Mumbai · 62.0 km",  score: "6,980", pct: 71,  trend: "up", isYou: false },
      { rank: 5, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  sub: "London · 12.4 km",  score: "6,440", pct: 65,  trend: "up", isYou: true  },
      { rank: 6, init: "TR", bg: "#F0FDF4", c: "#166534", name: "Tom R.",    sub: "London · 58.0 km",  score: "5,880", pct: 60,  trend: "dn", isYou: false },
      { rank: 7, init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.",  sub: "Milan · 44.0 km",   score: "5,220", pct: 53,  trend: "eq", isYou: false },
      { rank: 8, init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",   sub: "Dubai · 38.0 km",   score: "4,100", pct: 42,  trend: "up", isYou: false },
    ],
  },
  cycling: {
    banner: { rank: "#7", pts: "3,210", acts: "1", progressLabel: "Progress to rank #6", progressFrac: "3,210 / 3,660", fill: 46, next: "450 pts to overtake Priya R. — one group ride this weekend closes the gap.", sportLabel: "Cycling · Intermediate · 41 km this week" },
    podium: [
      { init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.", loc: "Milan",  score: "8,120", stat: "88 km / 241W",  rank: "gold"   },
      { init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",  loc: "Dubai",  score: "6,990", stat: "74 km / 228W",  rank: "silver" },
      { init: "TR", bg: "#F5F3FF", c: "#6D28D9", name: "Tom R.",   loc: "London", score: "5,440", stat: "61 km / 210W",  rank: "bronze" },
    ],
    rows: [
      { rank: 1, init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.", sub: "Milan · 88 km this week",   score: "8,120", pct: 100, trend: "up", isYou: false },
      { rank: 2, init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",  sub: "Dubai · 74 km this week",   score: "6,990", pct: 86,  trend: "eq", isYou: false },
      { rank: 3, init: "TR", bg: "#F5F3FF", c: "#6D28D9", name: "Tom R.",   sub: "London · 61 km this week",  score: "5,440", pct: 67,  trend: "up", isYou: false },
      { rank: 4, init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.", sub: "Prague · 52 km this week",  score: "4,880", pct: 60,  trend: "up", isYou: false },
      { rank: 5, init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.", sub: "Prague · 48 km this week",  score: "4,210", pct: 52,  trend: "dn", isYou: false },
      { rank: 6, init: "PR", bg: "#FBEAF0", c: "#9D174D", name: "Priya R.", sub: "Mumbai · 43 km this week",  score: "3,660", pct: 45,  trend: "eq", isYou: false },
      { rank: 7, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.", sub: "London · 41 km this week",  score: "3,210", pct: 40,  trend: "up", isYou: true  },
      { rank: 8, init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",  sub: "Tokyo · 30 km this week",   score: "2,440", pct: 30,  trend: "dn", isYou: false },
    ],
  },
  climbing: {
    banner: { rank: "#3", pts: "4,890", acts: "4", progressLabel: "Progress to rank #2", progressFrac: "4,890 / 5,990", fill: 72, next: "1,100 pts to overtake Sofia R. — send one more project this week.", sportLabel: "Climbing · Advanced · V6 × 4 this week" },
    podium: [
      { init: "AM", bg: "#ECFDF5", c: "#065F46", name: "Alena M.", loc: "Barcelona", score: "6,810", stat: "V8 sent", rank: "gold"   },
      { init: "SR", bg: "#F5F3FF", c: "#6D28D9", name: "Sofia R.", loc: "Barcelona", score: "5,990", stat: "V7 sent", rank: "silver" },
      { init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.", loc: "London",    score: "4,890", stat: "V6 × 4",  rank: "bronze", isYou: true },
    ],
    rows: [
      { rank: 1, init: "AM", bg: "#ECFDF5", c: "#065F46", name: "Alena M.", sub: "Barcelona · 4 sessions", score: "6,810", pct: 100, trend: "up", isYou: false },
      { rank: 2, init: "SR", bg: "#F5F3FF", c: "#6D28D9", name: "Sofia R.", sub: "Barcelona · 3 sessions", score: "5,990", pct: 88,  trend: "up", isYou: false },
      { rank: 3, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.", sub: "London · 4 sessions",    score: "4,890", pct: 72,  trend: "up", isYou: true  },
      { rank: 4, init: "TR", bg: "#F0FDF4", c: "#166534", name: "Tom R.",   sub: "London · 3 sessions",    score: "3,880", pct: 57,  trend: "up", isYou: false },
      { rank: 5, init: "OB", bg: "#FEF9C3", c: "#854D0E", name: "Omar B.",  sub: "Dubai · 2 sessions",     score: "2,990", pct: 44,  trend: "dn", isYou: false },
      { rank: 6, init: "PK", bg: "#FBEAF0", c: "#9D174D", name: "Priya K.", sub: "Mumbai · 2 sessions",    score: "2,110", pct: 31,  trend: "eq", isYou: false },
    ],
  },
};

const PERIOD_LABEL: Record<string, string> = { week: "Weekly", month: "Monthly", alltime: "All time" };
const TREND_ICON: Record<string, string> = { up: "↑ +2", dn: "↓ −1", eq: "—" };
const TREND_CLS: Record<string, string>  = { up: "trend-up", dn: "trend-dn", eq: "trend-eq" };
const RANK_CLS: Record<number, string>   = { 1: "top-1", 2: "top-2", 3: "top-3" };
const PLACE_EMOJI = ["🥈", "🥇", "🥉"];
const RANK_BORDER_CLS = ["silver", "gold", "bronze"];
const BLOCK_CLS = ["block-silver", "block-gold", "block-bronze"];

const SPORT_TABS = [
  { key: "all",      label: "🏅 All my sports", count: "3" },
  { key: "running",  label: "🏃 Running",        count: "612" },
  { key: "cycling",  label: "🚴 Cycling",        count: "488" },
  { key: "climbing", label: "🧗 Climbing",        count: "134" },
];

export default function Leaderboards() {
  const [sport, setSport]   = useState("all");
  const [period, setPeriod] = useState("week");
  const [scope, setScope]   = useState("local");
  const [metric, setMetric] = useState("pts");
  const [toast, setToast]   = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  const data = leaderboards[sport];
  const meta = sportMeta[sport];
  const { banner, podium, rows } = data;

  // Podium order: silver(left) gold(centre) bronze(right)
  const podiumOrder = [podium[1], podium[0], podium[2]];

  const scopeLabels: Record<string, string> = { local: "Local — London", national: "National — UK", global: "Global" };

  return (
    <div>
      <Topbar loggedIn={false} activeNav="Leaderboards" />

      {/* Page header */}
      <div className="lb-page-header">
        <div className="lb-page-header-inner">
          <div className="lb-header-left">
            <h1>Leaderboards 🏆</h1>
            <p>Rankings across your sports — updated every Monday at midnight.</p>
          </div>
          <div className="lb-header-right">
            <div className="lb-period-tabs">
              {(["week", "month", "alltime"] as const).map(p => (
                <button
                  key={p}
                  className={`lb-period-tab${period === p ? " active" : ""}`}
                  onClick={() => { setPeriod(p); showToast("Showing " + PERIOD_LABEL[p].toLowerCase() + " rankings"); }}
                  data-testid={`period-tab-${p}`}
                >
                  {p === "week" ? "This week" : p === "month" ? "This month" : "All time"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sport tab bar */}
      <div className="lb-sport-bar">
        <div className="lb-sport-bar-inner">
          {SPORT_TABS.map(t => (
            <button
              key={t.key}
              className={`lb-sport-nav-tab${sport === t.key ? " active" : ""}`}
              onClick={() => setSport(t.key)}
              data-testid={`sport-tab-${t.key}`}
            >
              {t.label} <span className="lb-count-pill">{t.count}</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div className="lb-sport-bar-right">
            <select
              className="lb-scope-select"
              value={scope}
              onChange={e => { setScope(e.target.value); showToast("Switched to " + scopeLabels[e.target.value] + " rankings"); }}
              data-testid="select-scope"
            >
              <option value="local">📍 Local — London</option>
              <option value="national">🇬🇧 National</option>
              <option value="global">🌍 Global</option>
            </select>
            <select
              className="lb-metric-select"
              value={metric}
              onChange={e => { setMetric(e.target.value); showToast("Ranked by " + e.target.value.replace("_", " ")); }}
              data-testid="select-metric"
            >
              {meta.metrics.map(m => (
                <option key={m} value={m.toLowerCase().replace(" ", "_")}>Ranked by: {m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="lb-main">

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Your position banner */}
          <div className="lb-your-banner">
            <div className="lb-yb-glow" />
            <div className="lb-yb-avatar">JK</div>
            <div className="lb-yb-info">
              <div className="lb-yb-name">Jamie K.</div>
              <div className="lb-yb-sub">{banner.sportLabel}</div>
            </div>
            <div className="lb-yb-stats">
              <div className="lb-yb-stat">
                <div className="lb-yb-stat-num">{banner.rank}</div>
                <div className="lb-yb-stat-label">Your rank</div>
              </div>
              <div className="lb-yb-stat">
                <div className="lb-yb-stat-num">{banner.pts}</div>
                <div className="lb-yb-stat-label">Points</div>
              </div>
              <div className="lb-yb-stat">
                <div className="lb-yb-stat-num">{banner.acts}</div>
                <div className="lb-yb-stat-label">Activities</div>
              </div>
            </div>
            <div className="lb-yb-progress-wrap">
              <div className="lb-yb-progress-label">
                <span>{banner.progressLabel}</span>
                <span style={{ fontFamily: "var(--mono)" }}>{banner.progressFrac}</span>
              </div>
              <div className="lb-yb-progress-bar">
                <div className="lb-yb-progress-fill" style={{ width: `${banner.fill}%` }} />
              </div>
              <div className="lb-yb-next-label">{banner.next}</div>
            </div>
          </div>

          {/* Podium */}
          <div className="lb-podium-wrap">
            <div className="lb-podium-header">
              <div className="lb-podium-header-left">
                <div className="lb-podium-sport-icon" style={{ background: meta.iconBg }}>{meta.icon}</div>
                <div>
                  <div className="lb-podium-title">{meta.label} — {PERIOD_LABEL[period]} top 3</div>
                  <div className="lb-podium-subtitle">
                    {sport === "all"
                      ? "Combined score across Running, Cycling & Climbing · Local"
                      : `${meta.label} · Local — London`}
                  </div>
                </div>
              </div>
            </div>
            <div className="lb-podium-stage">
              {podiumOrder.map((a, i) => (
                <div key={a.init + i} className="lb-podium-col">
                  <div className="lb-place-emoji">{PLACE_EMOJI[i]}</div>
                  <div className={`lb-podium-avatar ${RANK_BORDER_CLS[i]}`} style={{ background: a.bg, color: a.c }}>
                    {a.init}
                  </div>
                  <div className="lb-podium-pname">{a.name}{a.isYou ? " (you)" : ""}</div>
                  <div className="lb-podium-ploc">{a.loc}</div>
                  <div className="lb-podium-pscore">{a.score}</div>
                  <div className="lb-podium-pstat">{a.stat}</div>
                  <div className={`lb-podium-block ${BLOCK_CLS[i]}`} />
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: "var(--gray-100)", margin: "0 20px" }} />
          </div>

          {/* Full leaderboard table */}
          <div className="lb-table">
            <div className="lb-table-header">
              <div style={{ textAlign: "center" }}>Rank</div>
              <div>Athlete</div>
              <div style={{ textAlign: "right" }}>{meta.metrics[0]}</div>
              <div style={{ textAlign: "center" }}>Change</div>
              <div />
            </div>
            <div>
              {rows.map(r => (
                <div key={r.rank} className={`lb-row${r.isYou ? " is-you" : ""}`}>
                  <div className={`lb-rank ${RANK_CLS[r.rank] || ""}`}>{r.rank}</div>
                  <div className="lb-athlete">
                    <div className="lb-av" style={{ background: r.bg, color: r.c }}>{r.init}</div>
                    <div>
                      <div className="lb-name">
                        {r.name}
                        {r.isYou && <span style={{ fontSize: 10, color: "var(--gray-400)", fontWeight: 400 }}> (you)</span>}
                      </div>
                      <div className="lb-detail">{r.sub}</div>
                      <div className="lb-activity-bar">
                        <div className="lb-activity-fill" style={{ width: `${r.pct}%`, background: r.isYou ? "#F59E0B" : "var(--gray-300)" }} />
                      </div>
                    </div>
                  </div>
                  <div className="lb-score-cell">
                    <div className="lb-score-num">{r.score}</div>
                    <div className="lb-score-lbl">{meta.metrics[0].toLowerCase()}</div>
                  </div>
                  <div className="lb-trend-cell">
                    <span className={`lb-trend-chip ${TREND_CLS[r.trend]}`}>{TREND_ICON[r.trend]}</span>
                  </div>
                  <div style={{ position: "relative" }}>
                    {r.isYou && <span className="lb-you-tag">you</span>}
                  </div>
                </div>
              ))}
            </div>
            <button className="lb-load-btn" onClick={() => showToast("All athletes loaded for this scope")} data-testid="btn-load-more">
              ↓ Show more athletes
            </button>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="lb-right-col">

          {/* Active challenges */}
          <div className="lb-side-card">
            <div className="lb-side-title">Active challenges</div>
            {[
              { icon: "🏃", iconBg: "#FFF7ED", name: "100km May Run",    pct: 62, color: "#F97316", detail: "62 / 100 km · 9 days left",      pts: "+500" },
              { icon: "🚴", iconBg: "#EFF6FF", name: "Cycling Century",  pct: 88, color: "#3B82F6", detail: "88 / 100 mi · 21 days left",     pts: "+350" },
              { icon: "🧗", iconBg: "#F5F3FF", name: "V6+ send streak",  pct: 60, color: "#8B5CF6", detail: "3 / 5 sessions · ongoing",        pts: "+200" },
            ].map(ch => (
              <div key={ch.name} className="lb-challenge-row">
                <div className="lb-ch-icon" style={{ background: ch.iconBg }}>{ch.icon}</div>
                <div className="lb-ch-info">
                  <div className="lb-ch-name">{ch.name}</div>
                  <div className="lb-ch-bar-row">
                    <div className="lb-ch-bar"><div className="lb-ch-bar-fill" style={{ width: `${ch.pct}%`, background: ch.color }} /></div>
                    <span className="lb-ch-pct">{ch.pct}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 2 }}>{ch.detail}</div>
                </div>
                <div className="lb-ch-pts" style={{ color: "#3B6D11" }}>{ch.pts}</div>
              </div>
            ))}
            <div style={{ padding: "10px 16px" }}>
              <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 13 }}>Browse all challenges →</button>
            </div>
          </div>

          {/* Nearby athletes */}
          <div className="lb-side-card">
            <div className="lb-side-title">Near you — London</div>
            {[
              { rank: 1, init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  detail: "0.8 mi · Running",  pts: "9,840", isYou: false },
              { rank: 2, init: "AL", bg: "#E0F2FE", c: "#0369A1", name: "Alena L.",  detail: "1.4 mi · Running",  pts: "7,220", isYou: false },
              { rank: 3, init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "You",        detail: "— · Running",       pts: "6,440", isYou: true  },
              { rank: 4, init: "TR", bg: "#F0FDF4", c: "#166534", name: "Tom R.",    detail: "2.1 mi · Cycling",  pts: "5,880", isYou: false },
              { rank: 5, init: "PK", bg: "#FBEAF0", c: "#9D174D", name: "Priya K.",  detail: "2.9 mi · Yoga",     pts: "5,340", isYou: false },
              { rank: 6, init: "RW", bg: "#FEF3C7", c: "#92400E", name: "Rachel W.", detail: "3.4 mi · Swimming", pts: "4,910", isYou: false },
            ].map(nb => (
              <div key={nb.rank} className={`lb-nearby-row${nb.isYou ? " is-you" : ""}`}>
                <span className="lb-nb-rank" style={nb.isYou ? { color: "#D97706", fontWeight: 700 } : {}}>{nb.rank}</span>
                <div className="lb-nb-av" style={{ background: nb.bg, color: nb.c }}>{nb.init}</div>
                <div style={{ flex: 1 }}>
                  <div className="lb-nb-name">
                    {nb.name}
                    {nb.isYou && <span style={{ fontSize: 10, color: "var(--gray-400)" }}> (Jamie K.)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gray-400)" }}>{nb.detail}</div>
                </div>
                <span className="lb-nb-pts" style={nb.isYou ? { color: "#D97706", fontWeight: 600 } : {}}>{nb.pts}</span>
              </div>
            ))}
          </div>

          {/* Medals */}
          <div className="lb-side-card">
            <div className="lb-side-title">Your recent medals</div>
            {[
              { icon: "🥇", name: "London Running — Week 16",   date: "Apr 21, 2026", pts: "+500 pts" },
              { icon: "🥈", name: "UK Cycling — March",         date: "Mar 31, 2026", pts: "+300 pts" },
              { icon: "🏅", name: "100 activities milestone",   date: "Mar 14, 2026", pts: "+250 pts" },
              { icon: "🥉", name: "Climbing — February",        date: "Feb 28, 2026", pts: "+150 pts" },
            ].map(m => (
              <div key={m.name} className="lb-medal-row">
                <div className="lb-medal-icon">{m.icon}</div>
                <div className="lb-medal-info">
                  <div className="lb-medal-name">{m.name}</div>
                  <div className="lb-medal-date">{m.date}</div>
                </div>
                <div className="lb-medal-pts">{m.pts}</div>
              </div>
            ))}
            <div style={{ padding: "10px 16px" }}>
              <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 13 }}>View all achievements →</button>
            </div>
          </div>

          {/* Global top 5 */}
          <div className="lb-side-card">
            <div className="lb-side-title">Global top 5 — Running</div>
            {[
              { rank: 1, flag: "🇰🇪", name: "Amara O.",    pts: "48,200", rankStyle: { color: "#D97706", fontWeight: 700 } },
              { rank: 2, flag: "🇪🇹", name: "Desta M.",    pts: "44,880", rankStyle: { color: "var(--gray-500)", fontWeight: 700 } },
              { rank: 3, flag: "🇯🇵", name: "Yuki T.",     pts: "41,610", rankStyle: { color: "#B45309", fontWeight: 700 } },
              { rank: 4, flag: "🇵🇱", name: "Marek W.",    pts: "38,990", rankStyle: {} },
              { rank: 5, flag: "🇧🇷", name: "Fernanda S.", pts: "36,440", rankStyle: {} },
            ].map(g => (
              <div key={g.rank} className="lb-global-row">
                <span className="lb-gr-rank" style={g.rankStyle}>{g.rank}</span>
                <span className="lb-gr-flag">{g.flag}</span>
                <span className="lb-gr-name">{g.name}</span>
                <span className="lb-gr-pts">{g.pts}</span>
              </div>
            ))}
            <div style={{ padding: "8px 16px", borderTop: "var(--border)" }}>
              <div style={{ fontSize: 12, color: "var(--gray-400)", display: "flex", justifyContent: "space-between" }}>
                <span>Your global rank</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--gray-700)" }}>#2,841</span>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Toast */}
      <div className={`lb-toast${toastVisible ? " show" : ""}`}>{toast}</div>

      <Footer />
    </div>
  );
}
