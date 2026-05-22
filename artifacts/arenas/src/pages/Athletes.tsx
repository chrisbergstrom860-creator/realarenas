import { useState, useMemo } from "react";
import Topbar from "@/components/Topbar";
import Footer from "@/components/Footer";

// ── TYPES ──
type Sport = "running" | "cycling" | "climbing" | "swimming" | "basketball";
type Level = "Beginner" | "Intermediate" | "Advanced" | "Elite";
type SortKey = "near" | "active" | "followed" | "new";
type ShowFilter = "all" | "following" | "followers";
type SportFilter = "all" | "running" | "cycling" | "climbing";

interface Athlete {
  id: string; init: string; bg: string; c: string;
  name: string; handle: string; location: string; dist: string;
  bio: string; sports: Sport[]; tags: string[]; level: Level; online: boolean;
  stats: { v: string; l: string }[];
  spark: number[]; sparkColor: string;
  mutuals: { i: string; bg: string; c: string }[];
  mutualCount: number; isYou: boolean;
  fullStats: { v: string; l: string }[];
  activities: { icon: string; name: string; meta: string; stats: string[] }[];
  recWhy: string; recSport: string;
}

const TAG_CLS: Record<string, string> = {
  running: "ath-tag-run", cycling: "ath-tag-cyc", climbing: "ath-tag-clm",
  swm: "ath-tag-swm", run: "ath-tag-run", adv: "ath-tag-adv",
  int: "ath-tag-int", eli: "ath-tag-eli", beg: "ath-tag-beg",
  bkt: "ath-tag-bkt", tri: "ath-tag-tri",
};
const TAG_LABEL: Record<string, string> = {
  running: "Running", cycling: "Cycling", climbing: "Climbing",
  swm: "Swimming", run: "Running", adv: "Advanced",
  int: "Intermediate", eli: "Elite", beg: "Beginner",
  bkt: "Basketball", tri: "Triathlon",
};

const ATHLETES: Athlete[] = [
  {
    id: "sl", init: "SL", bg: "#FEF9C3", c: "#854D0E",
    name: "Sofia L.", handle: "@sofialopes", location: "Prague, CZ", dist: "0.8 mi",
    bio: "Marathon runner chasing sub-2:55. Logging every mile publicly. Coach at Sparta Athletic Club. Triathlon off-season.",
    sports: ["running"], tags: ["running","adv"], level: "Advanced", online: true,
    stats: [{v:"312",l:"activities"},{v:"2.4k",l:"followers"},{v:"88km",l:"this week"}],
    spark: [0.6,0.8,0.5,1.0,0.7,0.9,0.75], sparkColor: "#F97316",
    mutuals: [{i:"AL",bg:"#E0F2FE",c:"#0369A1"},{i:"TR",bg:"#F5F3FF",c:"#5B21B6"}], mutualCount: 2, isYou: false,
    fullStats: [{v:"312",l:"activities"},{v:"2.4k",l:"followers"},{v:"88 km",l:"this week"},{v:"9,840",l:"pts"}],
    activities: [{icon:"🏃",name:"Morning long run",meta:"London · Apr 21",stats:["12.4 km","4:23/km","148 bpm"]},{icon:"🏃",name:"Parkrun PB",meta:"Victoria Park · Apr 19",stats:["5 km","4:12/km"]},{icon:"🚴",name:"Recovery ride",meta:"Apr 18",stats:["22 km","1h 10m"]}],
    recWhy: "Prague · Advanced · Runs similar distances to you", recSport: "Running",
  },
  {
    id: "mc", init: "MC", bg: "#FEF9C3", c: "#854D0E",
    name: "Marco C.", handle: "@marcocycliste", location: "Milan, IT", dist: "8.1 mi",
    bio: "Granfondo specialist. 40,000 km logged in 2025. Stelvio is home. Leading the Milan Cycling collective on weekends.",
    sports: ["cycling"], tags: ["cycling","eli"], level: "Elite", online: false,
    stats: [{v:"287",l:"activities"},{v:"1.8k",l:"followers"},{v:"88km",l:"this week"}],
    spark: [0.9,1.0,0.6,0.8,1.0,0.7,0.85], sparkColor: "#3B82F6",
    mutuals: [{i:"OB",bg:"#F0FDF4",c:"#166534"}], mutualCount: 1, isYou: false,
    fullStats: [{v:"287",l:"activities"},{v:"1.8k",l:"followers"},{v:"88 km",l:"this week"},{v:"8,120",l:"pts"}],
    activities: [{icon:"🚴",name:"Stelvio approach",meta:"Milan · Apr 21",stats:["88 km","32.7 km/h","241W"]},{icon:"🚴",name:"Tuesday group ride",meta:"Apr 19",stats:["54 km","29.1 km/h"]},{icon:"🚴",name:"Recovery spin",meta:"Apr 18",stats:["24 km","1h 2m"]}],
    recWhy: "Milan · Elite · 3 friends follow him", recSport: "Cycling",
  },
  {
    id: "am", init: "AM", bg: "#ECFDF5", c: "#065F46",
    name: "Alena M.", handle: "@alenasends", location: "Barcelona, ES", dist: "12.4 mi",
    bio: "Sport climbing 7c+ and projecting 8a. Beta queen — detailed route breakdowns on every post. Guides trips to Siurana.",
    sports: ["climbing"], tags: ["climbing","adv"], level: "Advanced", online: true,
    stats: [{v:"144",l:"activities"},{v:"980",l:"followers"},{v:"V8",l:"top grade"}],
    spark: [0.5,0,0.8,1.0,0,0.9,0.7], sparkColor: "#8B5CF6",
    mutuals: [], mutualCount: 0, isYou: false,
    fullStats: [{v:"144",l:"activities"},{v:"980",l:"followers"},{v:"V8",l:"top grade"},{v:"6,810",l:"pts"}],
    activities: [{icon:"🧗",name:"Montserrat — V7 send",meta:"Barcelona · Apr 21",stats:["V7","3-wk project"]},{icon:"🧗",name:"Siurana sport climb",meta:"Apr 19",stats:["7b+","2h session"]},{icon:"🧗",name:"Campus board training",meta:"Apr 18",stats:["45 min","strength"]}],
    recWhy: "Barcelona · Advanced · Similar grade to you", recSport: "Climbing",
  },
  {
    id: "yt", init: "YT", bg: "#FCE7F3", c: "#9D174D",
    name: "Yuki T.", handle: "@yukitri", location: "Tokyo, JP", dist: "5,941 mi",
    bio: "Triathlete and open water swimmer. ITU age group competitor. Currently building toward Ironman 70.3 Cairns in October.",
    sports: ["swimming","running"], tags: ["swm","run","adv"], level: "Advanced", online: false,
    stats: [{v:"401",l:"activities"},{v:"1.2k",l:"followers"},{v:"7.6k",l:"pts"}],
    spark: [0.7,0.9,0.8,1.0,0.6,0.85,0.75], sparkColor: "#14B8A6",
    mutuals: [{i:"SL",bg:"#FEF9C3",c:"#854D0E"}], mutualCount: 1, isYou: false,
    fullStats: [{v:"401",l:"activities"},{v:"1.2k",l:"followers"},{v:"68 km",l:"this week"},{v:"7,610",l:"pts"}],
    activities: [{icon:"🏊",name:"Open water 5K",meta:"Lake Geneva · Apr 21",stats:["5 km","54:22","1:32/100m"]},{icon:"🏃",name:"Long run",meta:"Tokyo · Apr 20",stats:["21 km","4:18/km"]},{icon:"🚴",name:"Tempo ride",meta:"Apr 18",stats:["62 km","2h 14m"]}],
    recWhy: "Tokyo · Advanced · Also does triathlons", recSport: "Swimming",
  },
  {
    id: "pr", init: "PR", bg: "#FBEAF0", c: "#72243E",
    name: "Priya R.", handle: "@priyaruns", location: "Mumbai, IN", dist: "4,488 mi",
    bio: "Running for mental health. Completed 3 marathons in 2025. Targeting Boston 2027. Community running coach at weekends.",
    sports: ["running"], tags: ["running","adv"], level: "Advanced", online: false,
    stats: [{v:"198",l:"activities"},{v:"640",l:"followers"},{v:"62km",l:"this week"}],
    spark: [0.8,0.6,0.9,0.7,1.0,0.5,0.8], sparkColor: "#F97316",
    mutuals: [], mutualCount: 0, isYou: false,
    fullStats: [{v:"198",l:"activities"},{v:"640",l:"followers"},{v:"62 km",l:"this week"},{v:"6,980",l:"pts"}],
    activities: [{icon:"🏃",name:"Marathon pace run",meta:"Mumbai · Apr 21",stats:["20 km","4:28/km"]},{icon:"🏃",name:"Recovery jog",meta:"Apr 19",stats:["6 km","5:40/km"]},{icon:"🏃",name:"Track intervals",meta:"Apr 18",stats:["8× 800m","3:44 avg"]}],
    recWhy: "Mumbai · Advanced · Near your pace targets", recSport: "Running",
  },
  {
    id: "ob", init: "OB", bg: "#F0FDF4", c: "#166534",
    name: "Omar B.", handle: "@omarbikes", location: "Dubai, AE", dist: "3,382 mi",
    bio: "Cycling and basketball. Rides before sunrise every day. Planning a coast-to-coast UAE ride in Q3. Weekend 5-a-side too.",
    sports: ["cycling","basketball"], tags: ["cycling","bkt","int"], level: "Intermediate", online: false,
    stats: [{v:"156",l:"activities"},{v:"430",l:"followers"},{v:"74km",l:"this week"}],
    spark: [1.0,0.7,0.9,0.8,0.6,1.0,0.85], sparkColor: "#3B82F6",
    mutuals: [{i:"MC",bg:"#FEF9C3",c:"#854D0E"}], mutualCount: 1, isYou: false,
    fullStats: [{v:"156",l:"activities"},{v:"430",l:"followers"},{v:"74 km",l:"this week"},{v:"6,990",l:"pts"}],
    activities: [{icon:"🚴",name:"Sunrise coast ride",meta:"Dubai · Apr 21",stats:["74 km","2h 28m","32.1 km/h"]},{icon:"🏀",name:"5-a-side pickup",meta:"Apr 20",stats:["60 min","social"]},{icon:"🚴",name:"Hill intervals",meta:"Apr 18",stats:["38 km","6× climbs"]}],
    recWhy: "Dubai · Intermediate · Followed by Marco C.", recSport: "Cycling",
  },
  {
    id: "tr", init: "TR", bg: "#F5F3FF", c: "#5B21B6",
    name: "Tom R.", handle: "@tomruns", location: "London, UK", dist: "2.1 mi",
    bio: "Runner and cyclist. Commute by bike every day. Running club on Tuesdays. Head-to-head challenge with Jamie this week.",
    sports: ["running","cycling"], tags: ["running","cycling","int"], level: "Intermediate", online: true,
    stats: [{v:"212",l:"activities"},{v:"280",l:"followers"},{v:"21km",l:"this week"}],
    spark: [0.4,0.7,0.5,0.8,0.6,0.9,0.65], sparkColor: "#F97316",
    mutuals: [{i:"JK",bg:"#FFF7ED",c:"#9A3412"},{i:"AL",bg:"#E0F2FE",c:"#0369A1"}], mutualCount: 2, isYou: false,
    fullStats: [{v:"212",l:"activities"},{v:"280",l:"followers"},{v:"21 km",l:"this week"},{v:"5,880",l:"pts"}],
    activities: [{icon:"🏃",name:"Morning 5K",meta:"London · Apr 21",stats:["5.2 km","4:44/km"]},{icon:"🚴",name:"Commute ride",meta:"Apr 21",stats:["14 km","28 min"]},{icon:"🏃",name:"Running club",meta:"Apr 19",stats:["8 km","group run"]}],
    recWhy: "London · 2.1 mi away · 2 mutual friends", recSport: "Running",
  },
  {
    id: "al", init: "AL", bg: "#E0F2FE", c: "#0369A1",
    name: "Alena L.", handle: "@alenaprague", location: "Prague, CZ", dist: "1.4 mi",
    bio: "Running and climbing. Prague parkrun regular. Just moved to London — looking for running buddies and climbing partners.",
    sports: ["running","climbing"], tags: ["running","climbing","adv"], level: "Advanced", online: false,
    stats: [{v:"178",l:"activities"},{v:"520",l:"followers"},{v:"71km",l:"this week"}],
    spark: [0.6,0.9,0.7,0.5,0.8,1.0,0.75], sparkColor: "#F97316",
    mutuals: [{i:"MC",bg:"#FEF9C3",c:"#854D0E"},{i:"TR",bg:"#F5F3FF",c:"#5B21B6"}], mutualCount: 2, isYou: false,
    fullStats: [{v:"178",l:"activities"},{v:"520",l:"followers"},{v:"71 km",l:"this week"},{v:"7,220",l:"pts"}],
    activities: [{icon:"🏃",name:"Long run",meta:"London · Apr 21",stats:["18 km","4:30/km"]},{icon:"🧗",name:"Bouldering session",meta:"Apr 20",stats:["2h 10m","V6+"]},{icon:"🏃",name:"Easy recovery",meta:"Apr 18",stats:["6 km","5:20/km"]}],
    recWhy: "London · Advanced · 2 mutual friends", recSport: "Running",
  },
];

const FOLLOWER_IDS = new Set(["sl","mc","yt","tr","al"]);

function Sparkline({ values, color }: { values: number[]; color: string }) {
  return (
    <div className="ath-sparkline-wrap">
      <div className="ath-spark-label">WEEKLY ACTIVITY (7 DAYS)</div>
      <div className="ath-sparkline">
        {values.map((h, i) => (
          <div key={i} className="ath-s-bar" style={{ height: `${Math.max(h * 100, 8)}%`, background: color, opacity: 0.35 + h * 0.65 }} />
        ))}
      </div>
    </div>
  );
}

function AthTag({ tag }: { tag: string }) {
  return <span className={`ath-tag ${TAG_CLS[tag] || "ath-tag-int"}`}>{TAG_LABEL[tag] || tag}</span>;
}

function AthleteCard({
  a, isFollowing, listView, onFollow, onOpen,
}: {
  a: Athlete; isFollowing: boolean; listView: boolean; onFollow: (id: string) => void; onOpen: (id: string) => void;
}) {
  return (
    <div className={`ath-card${a.isYou ? " is-you" : ""}`} onClick={() => onOpen(a.id)} data-testid={`athlete-card-${a.id}`}>
      <div className="ath-card-body">
        {listView ? (
          <div className="ath-list-inner">
            <div style={{ flex: 1 }}>
              <div className="ath-head">
                <div className="ath-avatar-wrap">
                  <div className="ath-avatar" style={{ background: a.bg, color: a.c }}>{a.init}</div>
                  {a.online && <div className="ath-online-dot" />}
                </div>
                <div className="ath-name-row">
                  <div className="ath-name">{a.name}{a.isYou && <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400 }}> (you)</span>}</div>
                  <div className="ath-handle">{a.handle}</div>
                  <div className="ath-location">📍 {a.location} · {a.dist}</div>
                </div>
              </div>
              <div className="ath-bio">{a.bio}</div>
              <div className="ath-tags">{a.tags.map(t => <AthTag key={t} tag={t} />)}</div>
            </div>
            <div style={{ width: 200 }}>
              <div className="ath-stats">{a.stats.map(s => (
                <div key={s.l} className="ath-stat-pill"><div className="ath-sv">{s.v}</div><div className="ath-sl">{s.l}</div></div>
              ))}</div>
              <div className="ath-footer" style={{ padding: 0, borderTop: "none", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                <div className="ath-mutual-wrap">
                  {a.mutualCount > 0 ? (
                    <><div className="ath-mut-avs">{a.mutuals.map(m => <div key={m.i} className="ath-mut-av" style={{ background: m.bg, color: m.c }}>{m.i}</div>)}</div>
                    <span className="ath-mutual-text">{a.mutualCount} mutual</span></>
                  ) : <span className="ath-mutual-text" style={{ color: "var(--gray-400)" }}>No mutuals yet</span>}
                </div>
                {a.isYou ? (
                  <button className="ath-follow-btn you">Your profile</button>
                ) : (
                  <button
                    className={`ath-follow-btn${isFollowing ? " following" : ""}`}
                    onClick={e => { e.stopPropagation(); onFollow(a.id); }}
                  >{isFollowing ? "Following" : "Follow"}</button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="ath-head">
              <div className="ath-avatar-wrap">
                <div className="ath-avatar" style={{ background: a.bg, color: a.c }}>{a.init}</div>
                {a.online && <div className="ath-online-dot" />}
              </div>
              <div className="ath-name-row">
                <div className="ath-name">{a.name}{a.isYou && <span style={{ fontSize: 11, color: "var(--gray-400)", fontWeight: 400 }}> (you)</span>}</div>
                <div className="ath-handle">{a.handle}</div>
                <div className="ath-location">📍 {a.location} · {a.dist}</div>
              </div>
            </div>
            <div className="ath-bio">{a.bio}</div>
            <div className="ath-tags">{a.tags.map(t => <AthTag key={t} tag={t} />)}</div>
            <div className="ath-stats">{a.stats.map(s => (
              <div key={s.l} className="ath-stat-pill"><div className="ath-sv">{s.v}</div><div className="ath-sl">{s.l}</div></div>
            ))}</div>
            <Sparkline values={a.spark} color={a.sparkColor} />
          </>
        )}
      </div>
      {!listView && (
        <div className="ath-footer">
          <div className="ath-mutual-wrap">
            {a.mutualCount > 0 ? (
              <><div className="ath-mut-avs">{a.mutuals.map(m => <div key={m.i} className="ath-mut-av" style={{ background: m.bg, color: m.c }}>{m.i}</div>)}</div>
              <span className="ath-mutual-text">{a.mutualCount} mutual</span></>
            ) : <span className="ath-mutual-text" style={{ color: "var(--gray-400)" }}>No mutuals yet</span>}
          </div>
          {a.isYou ? (
            <button className="ath-follow-btn you">Your profile</button>
          ) : (
            <button
              className={`ath-follow-btn${isFollowing ? " following" : ""}`}
              onClick={e => { e.stopPropagation(); onFollow(a.id); }}
            >{isFollowing ? "Following" : "Follow"}</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Athletes() {
  const [followed, setFollowed] = useState<Set<string>>(new Set(["mc","yt"]));
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sortFilter, setSortFilter] = useState<SortKey>("near");
  const [searchQ, setSearchQ] = useState("");
  const [listView, setListView] = useState(false);
  const [modalId, setModalId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [newFollowers, setNewFollowers] = useState<Set<string>>(new Set(["pk"]));

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  function toggleFollow(id: string) {
    setFollowed(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); showToast("Unfollowed"); }
      else { next.add(id); showToast("✓ Following — they'll appear in your feed"); }
      return next;
    });
  }

  const filtered = useMemo(() => {
    let list = ATHLETES;
    if (sportFilter !== "all") list = list.filter(a => a.sports.includes(sportFilter as Sport));
    if (showFilter === "following") list = list.filter(a => followed.has(a.id));
    if (showFilter === "followers") list = list.filter(a => FOLLOWER_IDS.has(a.id));
    if (levelFilter !== "all") list = list.filter(a => a.level === levelFilter);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.handle.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        a.sports.some(s => s.includes(q)) ||
        a.bio.toLowerCase().includes(q)
      );
    }
    if (sortFilter === "active") list = [...list].sort((a, b) => parseInt(b.stats[0].v) - parseInt(a.stats[0].v));
    else if (sortFilter === "followed") list = [...list].sort((a, b) => parseFloat(b.stats[1].v) - parseFloat(a.stats[1].v));
    return list;
  }, [sportFilter, showFilter, levelFilter, sortFilter, searchQ, followed]);

  const modalAthlete = modalId ? ATHLETES.find(a => a.id === modalId) : null;

  return (
    <div>
      <Topbar loggedIn={false} activeNav="Athletes" />

      {/* Page header */}
      <div className="ath-page-header">
        <div className="ath-page-header-inner">
          <div className="ath-header-left">
            <h1>Athletes 🏅</h1>
            <p>Showing athletes who match your sports — Running, Cycling & Climbing. Follow to see their activities in your feed.</p>
            <div className="ath-header-stats">
              <div className="ath-header-stat"><div className="ath-stat-dot" style={{ background: "#10B981" }} /><strong>84,210</strong> athletes worldwide</div>
              <div className="ath-header-stat"><div className="ath-stat-dot" style={{ background: "#FFD21E" }} /><strong>4,120</strong> near London</div>
              <div className="ath-header-stat"><div className="ath-stat-dot" style={{ background: "#3B82F6" }} />You follow <strong>48</strong> athletes</div>
              <div className="ath-header-stat"><div className="ath-stat-dot" style={{ background: "#8B5CF6" }} /><strong>312</strong> followers</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flexShrink: 0, marginTop: 4 }}>
            <div className="ath-view-toggle">
              <button className={`ath-view-btn${!listView ? " active" : ""}`} onClick={() => setListView(false)} title="Grid view" data-testid="btn-grid-view">⊞</button>
              <button className={`ath-view-btn${listView ? " active" : ""}`} onClick={() => setListView(true)} title="List view" data-testid="btn-list-view">≡</button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="ath-filter-bar">
        <div className="ath-filter-bar-inner">
          <div className="ath-search-row">
            <div className="ath-search-wrap">
              <span className="ath-search-icon">🔍</span>
              <input
                className="ath-search-input"
                type="text"
                placeholder="Search by name, city, @handle or sport…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                data-testid="athlete-search"
              />
            </div>
            <select className="ath-filter-select" value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
              <option value="all">All levels</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
              <option value="Elite">Elite</option>
            </select>
            <select className="ath-filter-select" value={sortFilter} onChange={e => setSortFilter(e.target.value as SortKey)}>
              <option value="near">Near me first</option>
              <option value="active">Most active</option>
              <option value="followed">Most followed</option>
              <option value="new">Newest</option>
            </select>
          </div>
          <div className="ath-filter-pills-row">
            <span className="ath-filter-label">Sport:</span>
            {(["all","running","cycling","climbing"] as SportFilter[]).map(s => (
              <button key={s} className={`ath-fp${sportFilter === s ? " active" : ""}`} onClick={() => setSportFilter(s)}>
                {s === "all" ? "All my sports" : s === "running" ? "🏃 Running" : s === "cycling" ? "🚴 Cycling" : "🧗 Climbing"}
              </button>
            ))}
            <div className="ath-divider-v" />
            <span className="ath-filter-label">Show:</span>
            {(["all","following","followers"] as ShowFilter[]).map(s => (
              <button key={s} className={`ath-fp${showFilter === s ? " active-yellow" : ""}`} onClick={() => setShowFilter(s)}>
                {s === "all" ? "Everyone" : s === "following" ? "Following" : "Followers"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="ath-main">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Recommended strip */}
          <div>
            <div className="ath-section-head">
              <div className="ath-section-title">Recommended for you <span className="ath-section-count">· based on your sports & location</span></div>
              <span className="ath-section-link" onClick={() => showToast("Refreshing recommendations…")}>Refresh →</span>
            </div>
            <div className="ath-rec-strip-wrap">
              <div className="ath-rec-strip">
                {ATHLETES.slice(0, 6).map(a => (
                  <div key={a.id} className="ath-rec-card" onClick={() => setModalId(a.id)}>
                    <div className="ath-rec-avatar" style={{ background: a.bg, color: a.c }}>
                      {a.init}
                      {a.online && <div className="ath-rec-online" />}
                    </div>
                    <div className="ath-rec-name">{a.name}</div>
                    <span className={`ath-rec-sport-tag ${TAG_CLS[a.sports[0]] || "ath-tag-run"}`}>{a.recSport}</span>
                    <div className="ath-rec-why">{a.recWhy}</div>
                    <button
                      className={`ath-follow-btn${followed.has(a.id) ? " following" : ""}`}
                      style={{ width: "100%", fontSize: 12, padding: "5px 0" }}
                      onClick={e => { e.stopPropagation(); toggleFollow(a.id); }}
                    >{followed.has(a.id) ? "Following" : "Follow"}</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Grid / list */}
          <div>
            <div className="ath-section-head">
              <div className="ath-section-title">All athletes <span className="ath-section-count">· {filtered.length.toLocaleString()}</span></div>
              <span className="ath-section-link" onClick={() => showToast("Map view coming soon")}>📍 Map view</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: "var(--gray-900)", marginBottom: 6 }}>No athletes found</div>
                <div style={{ fontSize: 14, color: "var(--gray-500)" }}>Try adjusting your filters or search term.</div>
              </div>
            ) : (
              <div className={`ath-athletes-grid${listView ? " list-view" : ""}`}>
                {filtered.map(a => (
                  <AthleteCard key={a.id} a={a} isFollowing={followed.has(a.id)} listView={listView} onFollow={toggleFollow} onOpen={setModalId} />
                ))}
              </div>
            )}

            <div className="ath-load-more">
              <button className="ath-load-more-btn" onClick={() => showToast("Loading more athletes…")}>Load more athletes</button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="ath-right-col">

          {/* Network */}
          <div className="ath-side-card">
            <div className="ath-side-title">Your network</div>
            <div className="ath-network-grid">
              {[["48","Following"],["312","Followers"],["4","Mutuals"]].map(([v,l]) => (
                <div key={l} className="ath-net-stat"><div className="ath-nv">{v}</div><div className="ath-nl">{l}</div></div>
              ))}
            </div>
            <div style={{ padding: "12px 16px 4px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Recently followed you</div>
            </div>
            {[
              { init: "OB", bg: "#F0FDF4", c: "#166534", name: "Omar B.",   sub: "Cycling · Dubai · 2h ago",    id: "ob-nf" },
              { init: "PK", bg: "#FBEAF0", c: "#72243E", name: "Priya K.",  sub: "Yoga · London · 1d ago",      id: "pk-nf" },
              { init: "RW", bg: "#FEF3C7", c: "#92400E", name: "Rachel W.", sub: "Swimming · London · 2d ago",   id: "rw-nf" },
            ].map(f => (
              <div key={f.id} className="ath-new-follower">
                <div className="ath-nf-av" style={{ background: f.bg, color: f.c }}>{f.init}</div>
                <div className="ath-nf-info"><div className="ath-nf-name">{f.name}</div><div className="ath-nf-sub">{f.sub}</div></div>
                <button
                  className={`ath-nf-btn${newFollowers.has(f.id) ? " following" : ""}`}
                  disabled={newFollowers.has(f.id)}
                  onClick={() => { setNewFollowers(prev => new Set([...prev, f.id])); showToast("✓ Following back"); }}
                >{newFollowers.has(f.id) ? "Following" : "Follow back"}</button>
              </div>
            ))}
            <div style={{ padding: "10px 16px" }}>
              <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 13 }} onClick={() => showToast("Showing all followers")}>View all followers →</button>
            </div>
          </div>

          {/* Top in sports */}
          <div className="ath-side-card">
            <div className="ath-side-title">Top in your sports this week</div>
            {[
              { rank: 1,  rankCls: "gold",    init: "SL", bg: "#FEF9C3", c: "#854D0E", name: "Sofia L.",  sub: "Running · 9,840 pts",  id: "sl" },
              { rank: 2,  rankCls: "silver",  init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.",  sub: "Cycling · 8,120 pts",  id: "mc" },
              { rank: 3,  rankCls: "bronze",  init: "YT", bg: "#FCE7F3", c: "#9D174D", name: "Yuki T.",   sub: "Swimming · 7,610 pts", id: "yt" },
              { rank: 4,  rankCls: "",        init: "AM", bg: "#ECFDF5", c: "#065F46", name: "Alena M.",  sub: "Climbing · 6,810 pts", id: "am" },
              { rank: 5,  rankCls: "",        init: "PR", bg: "#FBEAF0", c: "#72243E", name: "Priya R.",  sub: "Running · 6,980 pts",  id: "pr" },
            ].map(r => (
              <div key={r.id} className="ath-side-row" onClick={() => setModalId(r.id)}>
                <span className={`ath-sr-rank${r.rankCls ? ` ${r.rankCls}` : ""}`}>{r.rank}</span>
                <div className="ath-sr-av" style={{ background: r.bg, color: r.c }}>{r.init}</div>
                <div className="ath-sr-info"><div className="ath-sr-name">{r.name}</div><div className="ath-sr-sub">{r.sub}</div></div>
                <button
                  className={`ath-follow-btn${followed.has(r.id) ? " following" : ""}`}
                  style={{ fontSize: 12, padding: "4px 12px" }}
                  onClick={e => { e.stopPropagation(); toggleFollow(r.id); }}
                >{followed.has(r.id) ? "Following" : "Follow"}</button>
              </div>
            ))}
          </div>

          {/* Activity feed */}
          <div className="ath-side-card">
            <div className="ath-side-title">Following activity</div>
            {[
              { init: "MC", bg: "#FEF9C3", c: "#854D0E", text: <><strong>Marco C.</strong> logged an 88km ride — Stelvio approach</>, chip: "241W · 32.7 km/h", time: "2h ago · Cycling" },
              { init: "YT", bg: "#FCE7F3", c: "#9D174D", text: <><strong>Yuki T.</strong> completed a 5K open water swim at Lake Geneva</>, chip: "1:32/100m · 54:22", time: "4h ago · Swimming" },
              { init: "PK", bg: "#FBEAF0", c: "#72243E", text: <><strong>Priya K.</strong> joined the 100km May Run challenge</>, chip: null, time: "6h ago · Challenge" },
              { init: "MC", bg: "#FEF9C3", c: "#854D0E", text: <><strong>Marco C.</strong> registered for Granfondo Stelvio 2026</>, chip: null, time: "1d ago · Event" },
              { init: "YT", bg: "#FCE7F3", c: "#9D174D", text: <><strong>Yuki T.</strong> hit a new weekly PB — 68 km running</>, chip: "4:18/km avg", time: "2d ago · Running" },
            ].map((f, i) => (
              <div key={i} className="ath-feed-item">
                <div className="ath-feed-item-row">
                  <div className="ath-feed-av" style={{ background: f.bg, color: f.c }}>{f.init}</div>
                  <div>
                    <div className="ath-feed-text">{f.text}</div>
                    {f.chip && <div className="ath-feed-stat-chip">{f.chip}</div>}
                    <div className="ath-feed-time">{f.time}</div>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: "10px 16px" }}>
              <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", fontSize: 13 }} onClick={() => showToast("Showing full feed")}>View full feed →</button>
            </div>
          </div>

          {/* Sport breakdown */}
          <div className="ath-side-card">
            <div className="ath-side-title">Athletes by sport — near you</div>
            {[
              { dot: "#F97316", name: "Running",  w: 88, count: "1,820" },
              { dot: "#3B82F6", name: "Cycling",  w: 68, count: "1,210" },
              { dot: "#10B981", name: "Football", w: 52, count: "880"   },
              { dot: "#14B8A6", name: "Swimming", w: 34, count: "610"   },
              { dot: "#8B5CF6", name: "Climbing", w: 24, count: "398"   },
              { dot: "#EC4899", name: "Yoga",     w: 18, count: "290"   },
            ].map(s => (
              <div key={s.name} className="ath-sport-breakdown-row">
                <div className="ath-sb-dot" style={{ background: s.dot }} />
                <span className="ath-sb-name">{s.name}</span>
                <div className="ath-sb-bar"><div className="ath-sb-fill" style={{ width: `${s.w}%`, background: s.dot, opacity: 0.6 }} /></div>
                <span className="ath-sb-count">{s.count}</span>
              </div>
            ))}
          </div>

        </div>
      </main>

      {/* Profile modal */}
      {modalAthlete && (
        <div className="ath-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalId(null); }}>
          <div className="ath-modal" onClick={e => e.stopPropagation()}>
            <div className="ath-modal-profile-header">
              <div className="ath-modal-av" style={{ background: modalAthlete.bg, color: modalAthlete.c }}>{modalAthlete.init}</div>
              <div style={{ flex: 1 }}>
                <div className="ath-modal-name">{modalAthlete.name}</div>
                <div className="ath-modal-handle">{modalAthlete.handle} · {modalAthlete.location}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {modalAthlete.tags.map(t => <AthTag key={t} tag={t} />)}
                </div>
              </div>
              <button className="ath-modal-close" onClick={() => setModalId(null)}>✕</button>
            </div>
            <div className="ath-modal-body">
              <div className="ath-modal-stat-row">
                {modalAthlete.fullStats.map(s => (
                  <div key={s.l} className="ath-modal-stat"><div className="ath-mv">{s.v}</div><div className="ath-ml">{s.l}</div></div>
                ))}
              </div>
              <div>
                <div className="ath-modal-section">About</div>
                <p style={{ fontSize: 14, color: "var(--gray-600)", lineHeight: 1.65 }}>{modalAthlete.bio}</p>
              </div>
              <div>
                <div className="ath-modal-section">Recent activities</div>
                <div className="ath-modal-recent-act">
                  {modalAthlete.activities.map((act, i) => (
                    <div key={i} className="ath-mra-item">
                      <div className="ath-mra-icon">{act.icon}</div>
                      <div className="ath-mra-info">
                        <div className="ath-mra-name">{act.name}</div>
                        <div className="ath-mra-meta">{act.meta}</div>
                      </div>
                      <div className="ath-mra-stats">
                        {act.stats.map(s => <span key={s} className="ath-mra-stat">{s}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="ath-modal-footer">
              <button
                className={`btn${followed.has(modalAthlete.id) ? " btn-ghost" : " btn-primary"}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => toggleFollow(modalAthlete.id)}
              >{followed.has(modalAthlete.id) ? "✓ Following" : "Follow"}</button>
              <button className="btn btn-ghost" onClick={() => setModalId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className={`ath-toast${toastVisible ? " show" : ""}`}>{toast}</div>
      <Footer />
    </div>
  );
}
