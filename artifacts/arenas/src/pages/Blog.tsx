import { useState } from "react";
import { useLocation } from "wouter";
import Footer from "@/components/Footer";

type Category = "all" | "product" | "training" | "community" | "events";

interface Post {
  id: string;
  cat: Category;
  tags: string[];
  thumb: string;
  thumbBg: string;
  title: string;
  excerpt: string;
  author: string;
  authorInit: string;
  authorBg: string;
  authorC: string;
  date: string;
  read: string;
  reads: string;
  body: string;
}

const CAT_COLOR: Record<string, string> = {
  product: "bl-cat-product",
  training: "bl-cat-training",
  community: "bl-cat-community",
  events: "bl-cat-events",
};
const CAT_LABEL: Record<string, string> = {
  product: "Product",
  training: "Training",
  community: "Community",
  events: "Events",
};

const FEATURED = {
  id: "feat",
  cat: "product" as Category,
  title: "Introducing AI Coach: personalised analysis on every workout you log",
  author: "Arenas Team",
  authorInit: "AT",
  authorBg: "#E0F2FE",
  authorC: "#0369A1",
  date: "May 21, 2026",
  read: "6 min",
  reads: "1.2k",
  excerpt:
    "Every activity you log on Arenas now gets a real-time AI coaching analysis — pace breakdown, heart rate zone commentary, recovery recommendations, and training suggestions grounded specifically in your own data. Here's how it works, what we built it for, and what's coming next.",
  body: `Today we're launching AI Coach — a feature we've been building toward since we started Arenas. The idea is simple: every activity you log should come with a personalised coaching analysis, not just a list of numbers.

**What AI Coach does**

When you log a run, ride, climb, swim, or any other activity, the AI Coach analyses your performance data in the context of your recent training history. It identifies patterns you'd need a human coach to spot — like your pace consistently dropping after 8km, or your heart rate running higher than normal on what should have been a recovery run.

The AI Coach is grounded specifically in your own data. It doesn't give generic advice about what runners should do — it tells you what you specifically should do based on what you specifically did today and over the past few weeks.

**How to use it**

After logging any activity, tap the "AI Coach" button on the activity card. The analysis appears immediately, with three sections: a performance summary, key insights from the session data, and training recommendations for the next 24–72 hours.

You can also ask follow-up questions in the chat tab — "Was my heart rate too high for a recovery run?", "How does this compare to last week?", "What should I focus on before Sunday's race?" — and get answers grounded in your actual data.

**What's coming next**

Over the coming weeks we're adding: weekly training load summaries, injury risk flagging based on training spikes, and race-day readiness scores. The AI Coach is free to use 5 times per month on the free plan, and unlimited on Pro.`,
};

const POSTS: Post[] = [
  {
    id: "p1", cat: "training", tags: ["cycling", "heartrate"],
    thumb: "🚴", thumbBg: "#EFF6FF",
    title: "What your cycling power data actually means — and what to do with it",
    excerpt: "FTP, W/kg, normalised power — the numbers in your ride data tell a clear story once you know how to read them. A plain-English guide for every rider, from commuter to gran fondo.",
    author: "Marco C.", authorInit: "MC", authorBg: "#FEF9C3", authorC: "#854D0E",
    date: "May 18, 2026", read: "8 min", reads: "2.4k",
    body: `If you ride with a power meter — or even if you use estimated power from apps like Strava — you're sitting on a goldmine of data that most riders completely ignore.

**What FTP actually tells you**

Functional Threshold Power (FTP) is the maximum average power you can sustain for roughly 60 minutes. It's the single most useful number in cycling because it's the anchor for everything else — your training zones, your W/kg for climbs, and your pacing strategy for events.

The AI Coach on Arenas now automatically detects when you're riding near your threshold and flags whether your power distribution was even or front-loaded — a key indicator of whether you went out too hard.

**Normalised power vs average power**

Average power understates how hard a ride actually was, because it treats every second equally. A 5-second sprint followed by coasting counts the same as steady riding at the same average. Normalised Power accounts for this by weighting harder efforts more heavily — it's a better proxy for the physiological cost of the ride.

When you see a Normalised Power significantly higher than Average Power, it means the ride was punchy and variable. That costs more energy than a steady effort at the same average — something the AI Coach specifically calls out in its recovery recommendations.`,
  },
  {
    id: "p2", cat: "community", tags: ["climbing"],
    thumb: "🧗", thumbBg: "#F5F3FF",
    title: "How Sofia found her climbing partners — and a coach — through Arenas",
    excerpt: "Moving to a new city with no climbing network is daunting. Sofia used Arenas to find session partners within a week, and a coach within a month. Here's her story.",
    author: "Sofia R.", authorInit: "SR", authorBg: "#F5F3FF", authorC: "#5B21B6",
    date: "May 14, 2026", read: "5 min", reads: "980",
    body: `Six months ago Sofia Ramos moved from Madrid to Barcelona for work. She'd been climbing for four years, was projecting V7, and had a regular crew back home she trained with twice a week. In Barcelona she knew exactly one person, and that person didn't climb.

**The first week**

"I tried going to the wall alone a couple of times. It's fine for projecting, but you miss the beta swaps, the motivation of watching someone else try your problem. I wanted to find people at my level."

Sofia filtered the Athletes tab by Climbing, Advanced level, and Barcelona location. She found 34 climbers within 15km. Within 48 hours she had three session partners lined up.

**Finding a coach**

Through the community she met Alena M., who turned out to run guided climbing trips to Siurana and offered occasional coaching sessions. Three weeks later they were on the wall together working the same V7 project.

"The thing that surprised me was how willing people were to just say yes. The Arenas profile shows your grade history and recent activity — so there's no awkward conversation about level. You already know if you'll be compatible session partners before you even DM."`,
  },
  {
    id: "p3", cat: "training", tags: ["running", "heartrate"],
    thumb: "🏃", thumbBg: "#FFF7ED",
    title: "Heart rate zones explained: why easy runs should feel embarrassingly slow",
    excerpt: "Most runners train too hard most of the time. Understanding zones — and why zone 2 feels almost insultingly easy — is the single biggest unlock for long-term running improvement.",
    author: "Jamie K.", authorInit: "JK", authorBg: "#FFF7ED", authorC: "#9A3412",
    date: "May 10, 2026", read: "7 min", reads: "1.8k",
    body: `The most common training mistake runners make isn't going too easy. It's going too hard on their easy days — and then not having enough left to push hard on their hard days. This is called the "grey zone", and it's where most recreational runners live.

**What zone 2 actually feels like**

Zone 2 is roughly 60–70% of your maximum heart rate. For most people this is a pace where you can hold a full conversation without gasping. It feels almost insultingly easy. You'll be overtaken by people who look like they're barely trying. You'll wonder if you're even getting a workout.

The Arenas AI Coach now automatically identifies when your HR drifts above zone 2 during a "recovery" run and flags it in your post-run analysis — so you can see the pattern without having to watch your watch while you run.

**Why it matters**

Zone 2 is where your body builds its aerobic base — the mitochondrial density and fat oxidation capacity that make everything else easier. Elites spend roughly 80% of their training volume in zone 2. The other 20% is genuinely hard — intervals, tempo runs, race pace work. There's very little in between.

The grey zone (zone 3, roughly 70–80% HR) is hard enough to accumulate fatigue but not hard enough to drive the adaptation you'd get from real zone 2 or real zone 4+ work. Most recreational runners spend most of their time here by accident.`,
  },
  {
    id: "p4", cat: "events", tags: ["events"],
    thumb: "📅", thumbBg: "#F5F3FF",
    title: "Events are now live: 2,100+ races, meetups and group sessions in one place",
    excerpt: "You can now browse, filter, and RSVP to events across 47 sports — filtered to your location, fitness level, and the sports on your profile. Here's what we built and what's coming next.",
    author: "Arenas Team", authorInit: "AT", authorBg: "#E0F2FE", authorC: "#0369A1",
    date: "May 6, 2026", read: "4 min", reads: "740",
    body: `Today we're launching Events — the most complete multi-sport event discovery tool we know of. 2,100+ events across 47 sports, filterable by your location, sport, distance from you, date, and difficulty level.

**How it's personalised**

Unlike generic race calendars, Events on Arenas knows what sports you do and what level you're at from your profile. When you open the tab, you immediately see events that make sense for you — not a list of triathlons when you only run, not elite-only races when you're a beginner.

The AI match score on each event card shows how well the event fits your current fitness based on your recent activity data — so you're not just browsing a list, you're seeing which events you could realistically target.

**What's coming next**

Over the next few weeks we're adding: team/club bulk registration so clubs can sign up their whole group in one step, training plan suggestions based on your event date, and post-event community threads where everyone who attended can share their experience and compare results.`,
  },
  {
    id: "p5", cat: "training", tags: ["swimming", "triathlon"],
    thumb: "🏊", thumbBg: "#F0FDFA",
    title: "Open water vs pool: how your swim metrics change and what to track",
    excerpt: "Pace per 100m means something very different in open water. A guide to adjusting your benchmarks and what the AI coach looks for across both formats.",
    author: "Yuki T.", authorInit: "YT", authorBg: "#FCE7F3", authorC: "#9D174D",
    date: "Apr 29, 2026", read: "6 min", reads: "610",
    body: `If you train in the pool and then race open water — or vice versa — you've probably noticed that your pace per 100m doesn't transfer directly. A 1:30/100m pool swimmer might find 1:45/100m a realistic open water target, and not because they're less fit.

**Why the numbers don't transfer**

Pool swimming has consistent turns, lane ropes that reduce chop, and no navigation overhead. Open water has all of these removed: you're sighting every 10 strokes, dealing with current, chop, and wetsuit buoyancy, and there are no walls to push off.

Arenas AI Coach now distinguishes between pool and open water swims automatically from your activity tags, and applies different benchmarks when analysing your performance — so you're not compared unfairly across formats.

**What to actually track**

In the pool: pace per 100m, stroke rate, SWOLF (strokes per length + time per length), and rest intervals. In open water: overall pace, navigation efficiency (how direct your line was), sighting frequency, and heart rate in the first 400m — open water starts are almost always more chaotic than training suggests.`,
  },
  {
    id: "p6", cat: "community", tags: ["running", "challenges"],
    thumb: "🏆", thumbBg: "#EAF3DE",
    title: "The 100km May Run challenge: who's leading and how to catch up",
    excerpt: "44 athletes are chasing 100 kilometres before May 31. A mid-month look at the leaderboard, the pacing strategies, and why the current leader from Tokyo is running more than anyone expected.",
    author: "Arenas Team", authorInit: "AT", authorBg: "#E0F2FE", authorC: "#0369A1",
    date: "Apr 25, 2026", read: "3 min", reads: "480",
    body: `With just over two weeks left in the 100km May Run challenge, the leaderboard is tighter than we expected. 44 athletes across 14 countries are competing, and the gap between first and fifth is less than 8km.

**The current standings**

Sofia L. from Prague leads with 94.2km logged — she's been running every single day without exception, averaging 6.7km per session. In second is Alena L. from London at 88.1km, who took two rest days early and has been making up ground with longer weekend runs.

Jamie K. sits in 5th with 62.4km — well within reach of the top three with 9 days remaining. At the current pace of 4.2km/day needed to complete the challenge, a couple of longer weekend runs could move him up significantly.

**Pacing strategies we've observed**

The leaders have taken different approaches: consistent daily volume, weekend heavy loading, and one athlete who did almost nothing for the first two weeks and is now running doubles to catch up. The AI coach has been flagging overtraining risk for several athletes in the final stretch — a useful reminder that finishing healthy matters more than finishing first.`,
  },
  {
    id: "p7", cat: "product", tags: ["challenges"],
    thumb: "⚙️", thumbBg: "#F3F4F6",
    title: "Leaderboards v2: local scope, multi-sport combined scores, and weekly resets",
    excerpt: "We've rebuilt leaderboards from the ground up. Here's what's new — local vs national vs global scope, combined cross-sport scoring, and how weekly resets keep competition fresh.",
    author: "Arenas Team", authorInit: "AT", authorBg: "#E0F2FE", authorC: "#0369A1",
    date: "Apr 18, 2026", read: "5 min", reads: "890",
    body: `Leaderboards launched in March. After four weeks of feedback, we've rebuilt them significantly. Here's what changed and why.

**Local scope by default**

The original leaderboard was global by default. Feedback was clear: competing against 84,000 athletes worldwide felt overwhelming and demotivating for most users. Local first — your city, your area — makes competition feel achievable and meaningful.

Arenas now shows you your local rank prominently, with national and global as optional zoom-outs. The "near you" sidebar shows the five athletes closest to you geographically — so you always have a direct rival to chase.

**Combined cross-sport scoring**

The "All my sports" tab now shows a genuinely combined score across every sport on your profile. A triathlete who swims, bikes, and runs all count together. A runner who also climbs gets credit for both. This is the leaderboard view no other platform offers — and it's the one most Arenas users check first.`,
  },
  {
    id: "p8", cat: "training", tags: ["climbing"],
    thumb: "🧗", thumbBg: "#F5F3FF",
    title: "Projecting above your limit: how to train for grades you can't yet send",
    excerpt: "The most efficient way to improve your climbing grade isn't to climb at your limit — it's to train specifically for the moves that make your limit problems feel impossible.",
    author: "Sofia R.", authorInit: "SR", authorBg: "#F5F3FF", authorC: "#5B21B6",
    date: "Apr 12, 2026", read: "9 min", reads: "720",
    body: `There's a common trap in climbing training: spending most of your time on routes you can already do. It feels productive — you're climbing, you're moving, you're getting laps in. But you're not getting better at the specific demands of your project.

**The specificity principle**

If your V7 project crux is a two-finger crimp on a sloper compression sequence, the best training for it is... that exact type of hold and movement pattern. Hangboarding on jugs won't help much. Campus boarding won't help much. Specific weakness work will.

Arenas now lets you tag your climbing sessions with the movement types you worked — crimp, sloper, undercling, dyno, compression — and the AI Coach tracks your progression on each over time. This makes it much easier to spot which weaknesses are actually limiting your grade.

**The three-phase approach**

For any given project: spend one session identifying the crux move type. Spend two to four sessions doing targeted weakness training for that move type (hangboard, system board, specific routes that force that pattern). Then return to the project. The improvement is often immediate and significant.`,
  },
];

const POPULAR = [
  { id: "p1", title: "What your cycling power data actually means", cat: "training", read: "8 min", reads: "2.4k" },
  { id: "p3", title: "Heart rate zones: why easy runs feel embarrassingly slow", cat: "training", read: "7 min", reads: "1.8k" },
  { id: "feat", title: "Introducing AI Coach: analysis on every workout", cat: "product", read: "6 min", reads: "1.2k" },
  { id: "p2", title: "How Sofia found her climbing partners through Arenas", cat: "community", read: "5 min", reads: "980" },
];

const TAGS = [
  { key: "running", label: "🏃 Running" },
  { key: "cycling", label: "🚴 Cycling" },
  { key: "climbing", label: "🧗 Climbing" },
  { key: "swimming", label: "🏊 Swimming" },
  { key: "ai", label: "✦ AI coaching" },
  { key: "heartrate", label: "❤️ Heart rate" },
  { key: "recovery", label: "💤 Recovery" },
  { key: "events", label: "📅 Events" },
  { key: "challenges", label: "🏆 Challenges" },
  { key: "nutrition", label: "🥗 Nutrition" },
  { key: "clubs", label: "🤝 Clubs" },
  { key: "triathlon", label: "🔱 Triathlon" },
];

const UPDATES = [
  { color: "#10B981", text: "AI Coach launched — live for all users", date: "May 21, 2026" },
  { color: "#3B82F6", text: "Events — 2,100+ listings now live", date: "May 6, 2026" },
  { color: "#8B5CF6", text: "Challenges — head-to-head mode", date: "Apr 18, 2026" },
  { color: "#F59E0B", text: "Clubs — coach dashboard launched", date: "Apr 2, 2026" },
  { color: "#F97316", text: "Athletes — discovery & follow system", date: "Mar 14, 2026" },
];

const CAT_SECTION_LABEL: Record<string, string> = {
  all: "Recent posts",
  product: "Product updates",
  training: "Training guides",
  community: "Community stories",
  events: "Events coverage",
};

function renderBody(body: string) {
  return body.split("\n\n").map((block, i) => {
    if (block.startsWith("**") && block.endsWith("**")) {
      return <h3 key={i} className="bl-modal-h3">{block.slice(2, -2)}</h3>;
    }
    const parts = block.split(/\*\*(.+?)\*\*/g);
    const callout = block.startsWith("The AI") || block.includes("Arenas AI Coach") || block.includes("Arenas now") || block.includes("AI Coach");
    if (callout && block.includes("now") && block.length < 300) {
      return <div key={i} className="bl-callout">{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}</div>;
    }
    return <p key={i} className="bl-modal-p">{parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}</p>;
  });
}

export default function Blog() {
  const [, setLocation] = useLocation();
  const [activeCat, setActiveCat] = useState<Category>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  const [subscribeEmail, setSubscribeEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  function handleSubscribe() {
    if (!subscribeEmail.includes("@")) { showToast("Please enter a valid email address"); return; }
    setSubscribed(true);
    showToast("🎉 Subscribed! First issue arrives next Monday.");
  }

  function handleCat(cat: Category) {
    setActiveCat(cat);
    setActiveTag(null);
  }

  function handleTag(key: string) {
    if (activeTag === key) { setActiveTag(null); return; }
    setActiveTag(key);
    setActiveCat("all");
  }

  const filtered = (() => {
    let base = activeCat === "all" ? POSTS : POSTS.filter(p => p.cat === activeCat);
    if (activeTag) base = POSTS.filter(p => p.tags.includes(activeTag));
    return base;
  })();

  const sectionLabel = activeTag
    ? `Posts tagged: ${TAGS.find(t => t.key === activeTag)?.label ?? activeTag}`
    : CAT_SECTION_LABEL[activeCat];

  const modalPost = openArticle === "feat"
    ? { ...FEATURED, tags: [] }
    : POSTS.find(p => p.id === openArticle);

  return (
    <div data-testid="page-blog">

      {/* ── TOPBAR ── */}
      <header className="topbar">
        <div className="topbar-inner" style={{ gap: 24 }}>
          <div className="logo" onClick={() => setLocation("/")} style={{ cursor: "pointer" }}>
            <div className="logo-icon">🏟</div>
            <span className="logo-text">Arenas</span>
          </div>
          <nav className="topnav">
            <a href="#" onClick={e => { e.preventDefault(); setLocation("/"); }}>Features</a>
            <a href="#" onClick={e => { e.preventDefault(); setLocation("/"); }}>Pricing</a>
            <a href="#" onClick={e => { e.preventDefault(); setLocation("/"); }}>For clubs</a>
            <a href="#" className="active" onClick={e => e.preventDefault()}>Blog</a>
          </nav>
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={() => setLocation("/login")}>Log in</button>
            <button className="btn btn-yellow" onClick={() => setLocation("/login?mode=signup")}>Sign up free</button>
          </div>
        </div>
      </header>

      {/* ── PAGE HEADER ── */}
      <div className="bl-page-header">
        <div className="bl-page-header-inner">
          <div>
            <h1 className="bl-page-h1">Arenas blog 📝</h1>
            <p className="bl-page-sub">Training insights, product news and community stories — updated every week.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 4, flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: "var(--gray-500)" }}>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--gray-900)" }}>6,400</span> subscribers
            </div>
            <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => { const el = document.getElementById("bl-subscribe-input"); el?.focus(); el?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Subscribe →</button>
          </div>
        </div>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px" }}>
          <div className="bl-cat-tabs">
            {(["all","product","training","community","events"] as Category[]).map(cat => (
              <button key={cat} className={`bl-cat-tab${activeCat === cat && !activeTag ? " active" : ""}`} onClick={() => handleCat(cat)}>
                {cat === "all" ? "All posts" : CAT_LABEL[cat]}
                <span className="bl-tab-count">
                  {cat === "all" ? POSTS.length + 1 : POSTS.filter(p => p.cat === cat).length + (cat === "product" ? 1 : 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <main className="bl-main">
        <div>

          {/* Featured */}
          {(activeCat === "all" || activeCat === "product") && !activeTag && (
            <div className="bl-featured-wrap">
              <div className="bl-featured-card" onClick={() => setOpenArticle("feat")}>
                <div className="bl-featured-visual">
                  <div className="bl-fac">
                    <div className="bl-fac-head">
                      <div className="bl-fac-av" style={{ background: "#FFF7ED", color: "#9A3412" }}>JK</div>
                      <div><div className="bl-fac-user">Jamie K.</div><div className="bl-fac-time">12 min ago · London</div></div>
                      <div className="bl-fac-sport-tag" style={{ background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                    </div>
                    <div className="bl-fac-stats">
                      {["12.4 km","54:22","4:23/km","148 bpm"].map(s => <div key={s} className="bl-fac-stat">{s}</div>)}
                    </div>
                    <div className="bl-fac-desc">Morning long run done ✓ PB attempt Sunday — anyone want to pace?</div>
                  </div>
                  <div className="bl-feat-ai-panel">
                    <div className="bl-feat-ai-icon">AI</div>
                    <div className="bl-feat-ai-text"><strong>AI Coach:</strong> HR spiked 12 bpm in the final 3km — classic glycogen depletion pattern. Keep tomorrow easy and you'll be fresh for Sunday's PB attempt.</div>
                  </div>
                </div>
                <div className="bl-featured-content">
                  <div className="bl-featured-badge">
                    <span className="bl-cat-pill bl-cat-product">Product</span>
                    <span className="bl-new-tag">✦ New</span>
                  </div>
                  <div className="bl-featured-title">{FEATURED.title}</div>
                  <div className="bl-featured-excerpt">{FEATURED.excerpt}</div>
                  <div className="bl-featured-meta">
                    <div className="bl-meta-author">
                      <div className="bl-meta-av" style={{ background: FEATURED.authorBg, color: FEATURED.authorC }}>{FEATURED.authorInit}</div>
                      {FEATURED.author}
                    </div>
                    <span className="bl-meta-sep">·</span>
                    <span>{FEATURED.date}</span>
                    <span className="bl-meta-sep">·</span>
                    <span className="bl-read-time">{FEATURED.read} read</span>
                  </div>
                  <button className="btn btn-primary" onClick={e => { e.stopPropagation(); setOpenArticle("feat"); }}>Read article →</button>
                </div>
              </div>
            </div>
          )}

          {/* Posts grid */}
          <div className="bl-section-row">
            <div className="bl-section-title">{sectionLabel}</div>
            <a className="bl-section-link" href="#">RSS feed →</a>
          </div>

          {filtered.length === 0 ? (
            <div className="bl-empty-state">
              <div style={{ fontSize: 36 }}>🔍</div>
              <h3>No posts found</h3>
              <p>Try a different category or topic tag.</p>
            </div>
          ) : (
            <div className="bl-posts-grid">
              {filtered.map(p => (
                <div key={p.id} className="bl-post-card" onClick={() => setOpenArticle(p.id)}>
                  <div className="bl-post-thumb" style={{ background: p.thumbBg }}>
                    {p.thumb}
                    <div className="bl-post-thumb-label">{p.read} read</div>
                  </div>
                  <div className="bl-post-body">
                    <div><span className={`bl-cat-pill ${CAT_COLOR[p.cat]}`}>{CAT_LABEL[p.cat]}</span></div>
                    <div className="bl-post-title">{p.title}</div>
                    <div className="bl-post-excerpt">{p.excerpt}</div>
                  </div>
                  <div className="bl-post-footer">
                    <div className="bl-post-author">
                      <div className="bl-post-author-av" style={{ background: p.authorBg, color: p.authorC }}>{p.authorInit}</div>
                      {p.author}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span className="bl-post-date">{p.date.split(",")[0]}</span>
                      <span className="bl-post-reads">{p.reads} reads</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bl-load-more">
            <button className="bl-load-more-btn" onClick={() => showToast("All posts loaded")}>Load more posts</button>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="bl-right-col">

          {/* Subscribe */}
          <div className="bl-side-card">
            <div className="bl-side-title">Weekly training tips</div>
            <div className="bl-subscribe-body">
              <div className="bl-subscribe-desc">One email per week — sport-specific training insights, product updates, and community stories. No spam, ever.</div>
              <input id="bl-subscribe-input" className="bl-subscribe-input" type="email" placeholder="your@email.com" value={subscribeEmail} onChange={e => setSubscribeEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubscribe()} disabled={subscribed}/>
              <button className={`bl-subscribe-btn${subscribed ? " done" : ""}`} onClick={handleSubscribe} disabled={subscribed}>
                {subscribed ? "✓ Subscribed — welcome!" : "Subscribe free"}
              </button>
              <div className="bl-subscribe-note">Join 6,400 athletes already subscribed</div>
            </div>
          </div>

          {/* Popular */}
          <div className="bl-side-card">
            <div className="bl-side-title">Popular this month</div>
            {POPULAR.map((p, i) => (
              <div key={p.id} className="bl-popular-item" onClick={() => setOpenArticle(p.id)}>
                <div className="bl-pop-num">{i + 1}</div>
                <div className="bl-pop-info">
                  <div className="bl-pop-title">{p.title}</div>
                  <div className="bl-pop-meta">
                    <span className={`bl-cat-pill ${CAT_COLOR[p.cat]}`} style={{ fontSize: 9, padding: "1px 6px" }}>{CAT_LABEL[p.cat]}</span>
                    · {p.read} · {p.reads} reads
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tags */}
          <div className="bl-side-card">
            <div className="bl-side-title">Browse by topic</div>
            <div className="bl-tag-cloud">
              {TAGS.map(t => (
                <button key={t.key} className={`bl-tag-item${activeTag === t.key ? " active" : ""}`} onClick={() => handleTag(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Latest releases */}
          <div className="bl-side-card">
            <div className="bl-side-title">Latest releases</div>
            {UPDATES.map((u, i) => (
              <div key={i} className="bl-update-item">
                <div className="bl-update-dot" style={{ background: u.color }}/>
                <div className="bl-update-info">
                  <div className="bl-update-text" dangerouslySetInnerHTML={{ __html: u.text.replace(/^([^—]+)/, "<strong>$1</strong>") }}/>
                  <div className="bl-update-date">{u.date}</div>
                </div>
              </div>
            ))}
          </div>

          {/* About */}
          <div className="bl-side-card">
            <div className="bl-side-title">About this blog</div>
            <div className="bl-about-body">
              <div className="bl-about-text">Written by the Arenas team and community athletes. We cover training science, product updates, and stories from the people using Arenas to train smarter.</div>
              <div className="bl-about-authors">
                {[
                  { init: "AT", bg: "#E0F2FE", c: "#0369A1", name: "Arenas Team", role: "Product & company news" },
                  { init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",   role: "Running & endurance" },
                  { init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.",   role: "Cycling & power training" },
                  { init: "SR", bg: "#F5F3FF", c: "#5B21B6", name: "Sofia R.",   role: "Climbing & technique" },
                ].map(a => (
                  <div key={a.name} className="bl-about-author">
                    <div className="bl-aa-av" style={{ background: a.bg, color: a.c }}>{a.init}</div>
                    <div><div className="bl-aa-name">{a.name}</div><div className="bl-aa-role">{a.role}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>

      <Footer />

      {/* ── ARTICLE MODAL ── */}
      {openArticle && modalPost && (
        <div className="bl-modal-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("bl-modal-overlay")) setOpenArticle(null); }}>
          <div className="bl-modal">
            <div className="bl-modal-header">
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span className={`bl-cat-pill ${CAT_COLOR[modalPost.cat]}`}>{CAT_LABEL[modalPost.cat]}</span>
                  {openArticle === "feat" && <span className="bl-new-tag">✦ New</span>}
                </div>
                <div className="bl-modal-title">{modalPost.title}</div>
                <div className="bl-modal-meta">
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div className="bl-meta-av" style={{ background: modalPost.authorBg, color: modalPost.authorC }}>{modalPost.authorInit}</div>
                    {modalPost.author}
                  </div>
                  <span style={{ color: "var(--gray-300)" }}>·</span>
                  <span>{modalPost.date}</span>
                  <span style={{ color: "var(--gray-300)" }}>·</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{modalPost.read} read</span>
                </div>
              </div>
              <button className="bl-modal-close" onClick={() => setOpenArticle(null)}>✕</button>
            </div>
            <div className="bl-article-body">
              {renderBody(modalPost.body)}
            </div>
            <div className="bl-article-cta">
              <div className="bl-article-cta-text"><strong>Want AI coaching on your workouts?</strong> Join Arenas free — no credit card needed.</div>
              <button className="btn btn-yellow" onClick={() => { setOpenArticle(null); setLocation("/login?mode=signup"); }}>Get started free →</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      <div className={`bl-toast${toastVisible ? " show" : ""}`}>{toast}</div>
    </div>
  );
}
