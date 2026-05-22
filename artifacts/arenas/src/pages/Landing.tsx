import { useLocation } from "wouter";
import Footer from "@/components/Footer";

const SPORTS = [
  "🏃 Running","🚴 Cycling","🏊 Swimming","🧗 Climbing","⚽ Football",
  "🏀 Basketball","🎾 Tennis","🧘 Yoga","🏋️ Weightlifting","🥊 Boxing",
  "🏄 Surfing","⛷️ Skiing","🏌️ Golf","🤸 Gymnastics","🚣 Rowing",
  "🏒 Ice Hockey","🏹 Archery","🤼 Wrestling","🏇 Equestrian","🏐 Volleyball",
];

export default function Landing() {
  const [, setLocation] = useLocation();

  const goSignup = () => setLocation("/login?mode=signup");
  const goLogin  = () => setLocation("/login");

  return (
    <div data-testid="page-landing">

      {/* ── TOPBAR (marketing nav) ── */}
      <header className="topbar">
        <div className="topbar-inner" style={{ gap: 24 }}>
          <div className="logo" onClick={() => setLocation("/")} style={{ cursor: "pointer" }} data-testid="logo-link">
            <div className="logo-icon">🏟</div>
            <span className="logo-text">Arenas</span>
          </div>
          <nav className="topnav">
            <a href="#features" onClick={e => { e.preventDefault(); document.getElementById("features")?.scrollIntoView({ behavior: "smooth" }); }}>Features</a>
            <a href="#pricing"  onClick={e => { e.preventDefault(); document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" }); }}>Pricing</a>
            <a href="#for-clubs" onClick={e => { e.preventDefault(); document.getElementById("for-clubs")?.scrollIntoView({ behavior: "smooth" }); }}>For clubs</a>
            <a href="#blog">Blog</a>
          </nav>
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={goLogin} data-testid="btn-login">Log in</button>
            <button className="btn btn-yellow" onClick={goSignup} data-testid="btn-signup" style={{ fontWeight: 600 }}>Sign up free</button>
          </div>
        </div>
      </header>

      {/* ── SPLIT HERO ── */}
      <div className="ld-split-hero">

        {/* Left: headline + CTA */}
        <div className="ld-hero-left">
          <div className="ld-hero-eyebrow">🏅 <span style={{ fontFamily: "var(--mono)" }}>84,000+</span> athletes · 47 sports</div>
          <h1 className="ld-hero-h1">Every sport.<br/><em>One community.</em></h1>
          <p className="ld-hero-sub">Share workouts, get AI coaching on every activity, discover events, and find athletes who train as hard as you do.</p>
          <div className="ld-hero-cta">
            <button className="btn btn-yellow ld-btn-lg" onClick={goSignup} data-testid="hero-btn-signup">Get started free →</button>
            <button className="btn btn-ghost ld-btn-lg" onClick={goLogin} data-testid="hero-btn-login">Log in</button>
          </div>
          <div className="ld-hero-note">No credit card required · Free forever plan available</div>
          <div className="ld-hero-social-proof">
            <div className="ld-hsp-avatars">
              {[["JK","#FFF7ED","#9A3412"],["SL","#FEF9C3","#854D0E"],["MC","#E0F2FE","#0369A1"],["SR","#F5F3FF","#6D28D9"],["YT","#FCE7F3","#9D174D"]].map(([i,bg,c]) => (
                <div key={i} className="ld-hsp-av" style={{ background: bg, color: c }}>{i}</div>
              ))}
            </div>
            <div className="ld-hsp-text"><strong>4,800+ athletes</strong> joined this week alone</div>
          </div>
        </div>

        {/* Right: live feed preview */}
        <div className="ld-hero-right">
          <div className="ld-hero-right-header">
            <div className="ld-live-badge"><div className="ld-live-dot"/><span>Live activity feed</span></div>
            <div className="ld-live-count">312,841 activities logged</div>
          </div>
          <div className="ld-feed-preview">

            {/* Card 1 — Running + AI */}
            <div className="ld-prev-card">
              <div className="ld-prev-card-body">
                <div className="ld-prev-head">
                  <div className="ld-prev-av" style={{ background: "#FFF7ED", color: "#9A3412" }}>JK</div>
                  <div><div className="ld-prev-user">Jamie K.</div><div className="ld-prev-time">7 min ago · London</div></div>
                  <div className="ld-prev-sport-tag" style={{ background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74" }}>🏃 Running</div>
                </div>
                <div className="ld-prev-stats">
                  {[["12.4","km"],["54:22","time"],["4:23","/km"],["148","bpm"]].map(([v,l]) => (
                    <div key={l} className="ld-prev-stat"><div className="ld-pv">{v}</div><div className="ld-pl">{l}</div></div>
                  ))}
                </div>
                <div className="ld-prev-desc">Morning long run done ✓ PB attempt this Sunday — anyone in London want to pace?</div>
              </div>
              <div className="ld-prev-ai-panel">
                <div className="ld-prev-ai-icon">AI</div>
                <div className="ld-prev-ai-text"><strong>AI Coach:</strong> Solid effort — your pace held well through mile 6. HR spiked 12 bpm in the final 3km, suggesting glycogen depletion. Keep tomorrow easy, then hit Sunday's PB fresh.</div>
              </div>
            </div>

            {/* Card 2 — Climbing */}
            <div className="ld-prev-card">
              <div className="ld-prev-card-body">
                <div className="ld-prev-head">
                  <div className="ld-prev-av" style={{ background: "#F5F3FF", color: "#6D28D9" }}>SR</div>
                  <div><div className="ld-prev-user">Sofia R.</div><div className="ld-prev-time">22 min ago · Barcelona</div></div>
                  <div className="ld-prev-sport-tag" style={{ background: "#F5F3FF", color: "#5B21B6", border: "1px solid #C4B5FD" }}>🧗 Climbing</div>
                </div>
                <div className="ld-prev-stats">
                  {[["V7","grade"],["Sent ✓","status"],["3 wks","project"]].map(([v,l]) => (
                    <div key={l} className="ld-prev-stat"><div className="ld-pv">{v}</div><div className="ld-pl">{l}</div></div>
                  ))}
                </div>
                <div className="ld-prev-desc">Finally sent the V7 at Montserrat — crux was the undercling. Beta in comments.</div>
              </div>
            </div>

            {/* Card 3 — Cycling */}
            <div className="ld-prev-card">
              <div className="ld-prev-card-body">
                <div className="ld-prev-head">
                  <div className="ld-prev-av" style={{ background: "#FEF9C3", color: "#854D0E" }}>MC</div>
                  <div><div className="ld-prev-user">Marco C.</div><div className="ld-prev-time">1h ago · Milan</div></div>
                  <div className="ld-prev-sport-tag" style={{ background: "#EFF6FF", color: "#1E40AF", border: "1px solid #93C5FD" }}>🚴 Cycling</div>
                </div>
                <div className="ld-prev-stats">
                  {[["88","km"],["241","avg W"],["1,240","elev m"]].map(([v,l]) => (
                    <div key={l} className="ld-prev-stat"><div className="ld-pv">{v}</div><div className="ld-pl">{l}</div></div>
                  ))}
                </div>
                <div className="ld-prev-desc">Stelvio approach done — Saturday group ride open, DM to join. Cap 12 riders.</div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── SPORT SCROLL ── */}
      <div className="ld-sport-scroll">
        <div className="ld-sport-scroll-inner">
          {[...SPORTS, ...SPORTS].map((s, i) => (
            <div key={i} className="ld-sport-pill">{s}</div>
          ))}
        </div>
      </div>

      {/* ── STATS BAR ── */}
      <div className="ld-stats-bar">
        <div className="ld-stats-bar-inner">
          {[
            { num: "84k",  label: "Athletes worldwide",   delta: "↑ +1.2k this week", pulse: true },
            { num: "312k", label: "Activities logged",    delta: "↑ +4.8k today",     pulse: true },
            { num: "2.1k", label: "Upcoming events",      delta: "↑ +38 this week",   pulse: true },
            { num: "47",   label: "Sports covered",       delta: "↑ +2 this month",   pulse: false },
          ].map(s => (
            <div key={s.label} className="ld-stat-item">
              <div className="ld-stat-num">{s.num}</div>
              <div className="ld-stat-label">{s.label}</div>
              <div className="ld-stat-delta">{s.pulse && <span className="ld-stat-pulse"/>}{s.delta}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FEATURES ── */}
      <div className="ld-features" id="features">
        <div className="ld-features-inner">
          <div className="ld-section-label">Why Arenas</div>
          <div className="ld-section-title">Everything your training needs, in one place</div>
          <div className="ld-features-grid">
            {[
              { icon: "✦", bg: "#FFF9E0", title: "AI-powered coaching",      badge: "badge-ai",   badgeText: "✦ AI Coach",      desc: "Every activity you log gets a personalised AI analysis — pace breakdown, heart rate zones, recovery recommendations, and training suggestions grounded in your own data." },
              { icon: "🏟", bg: "#F0FDF4", title: "Cross-sport community",   badge: "badge-free", badgeText: "Free forever",    desc: "Running, cycling, climbing, football, swimming — all in one feed. Follow athletes across sports and discover a community Strava's siloed design doesn't allow." },
              { icon: "📅", bg: "#EFF6FF", title: "Event discovery",         badge: "badge-free", badgeText: "Free forever",    desc: "2,100+ events across 47 sports. AI matches you with events that suit your fitness profile and connects you with athletes already registered near you." },
              { icon: "🏆", bg: "#FDF4FF", title: "Leaderboards & challenges",badge: "badge-free", badgeText: "Free forever",   desc: "Weekly sport leaderboards, monthly challenges, and club competitions. Earn points for every activity and climb the rankings against athletes at your level." },
              { icon: "🔗", bg: "#FFF7ED", title: "Strava & device sync",    badge: "badge-free", badgeText: "Free forever",    desc: "Connect Strava, Garmin, Wahoo, or Apple Watch. Activities sync automatically — your stats flow straight into your Arenas feed without manual logging." },
              { icon: "📈", bg: "#F0FDF4", title: "Training analytics",      badge: "badge-pro",  badgeText: "Pro feature",     desc: "Trend analysis across weeks and months. Track your training load, spot patterns in your performance, and understand how your fitness is actually progressing." },
            ].map(f => (
              <div key={f.title} className="ld-feature-card">
                <div className="ld-feature-icon" style={{ background: f.bg }}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                <span className={`ld-feature-badge ld-${f.badge}`}>{f.badgeText}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div className="ld-how-it-works">
        <div className="ld-how-inner">
          <div className="ld-section-label" style={{ textAlign: "center" }}>How it works</div>
          <div className="ld-section-title" style={{ textAlign: "center", margin: "0 auto 0", maxWidth: 520 }}>Up and running in four steps</div>
          <div className="ld-steps-grid">
            {[
              { n: "1", title: "Create your profile",   desc: "Pick your sports, set your level, and connect your location. Takes 90 seconds.", first: true },
              { n: "2", title: "Connect Strava",         desc: "Your past and future activities sync automatically — no manual logging.", first: false },
              { n: "3", title: "Get AI coaching",        desc: "Every workout gets a personalised analysis grounded in your data.", first: false },
              { n: "4", title: "Find your people",       desc: "Follow athletes in your sports, join challenges, and discover nearby events.", first: false },
            ].map(s => (
              <div key={s.n} className="ld-step">
                <div className={`ld-step-num${s.first ? " first" : ""}`}>{s.n}</div>
                <div className="ld-step-title">{s.title}</div>
                <div className="ld-step-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── TESTIMONIALS ── */}
      <div className="ld-social-proof">
        <div className="ld-social-proof-inner">
          <div className="ld-section-label" style={{ textAlign: "center" }}>Athletes love it</div>
          <div className="ld-section-title" style={{ textAlign: "center", margin: "0 auto 0", maxWidth: 500 }}>What the community is saying</div>
          <div className="ld-testimonials">
            {[
              { text: '"The AI coach is the reason I came back. It told me my heart rate was too high for a recovery run before I even realised — and it was right."', init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  sport: "Running · London" },
              { text: '"Finally a place where my running AND my climbing coexist. I don\'t have to choose which sport identity to post from."',                          init: "SR", bg: "#F5F3FF", c: "#6D28D9", name: "Sofia R.", sport: "Climbing · Barcelona" },
              { text: '"Found 8 riders for my Stelvio group through Arenas Events. Never met them before — now we ride every Saturday. That\'s a product doing something real."', init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.", sport: "Cycling · Milan" },
            ].map(t => (
              <div key={t.name} className="ld-testimonial">
                <div className="ld-stars">★★★★★</div>
                <div className="ld-testimonial-text">{t.text}</div>
                <div className="ld-testimonial-author">
                  <div className="ld-t-avatar" style={{ background: t.bg, color: t.c }}>{t.init}</div>
                  <div><div className="ld-t-name">{t.name}</div><div className="ld-t-sport">{t.sport}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PRICING ── */}
      <div className="ld-pricing" id="pricing">
        <div className="ld-pricing-inner">
          <div className="ld-section-label">Pricing</div>
          <div className="ld-section-title">Simple, transparent pricing</div>
          <div className="ld-pricing-grid">

            {/* Free */}
            <div className="ld-pricing-card">
              <div className="ld-pricing-name">Free</div>
              <div className="ld-pricing-desc">Everything you need to get started and stay active with the community.</div>
              <div className="ld-pricing-price"><span className="ld-pricing-amount">$0</span><span className="ld-pricing-period">/ month</span></div>
              <div className="ld-pricing-billed">Free forever — no credit card needed</div>
              <div className="ld-pricing-divider"/>
              <div className="ld-pricing-features">
                {["Activity feed across all sports","5 AI coach analyses per month","Follow up to 50 athletes","Event discovery & RSVP","Weekly leaderboards","Up to 3 active challenges"].map(f => (
                  <div key={f} className="ld-pricing-feat"><span className="ld-pfeat-tick">✓</span>{f}</div>
                ))}
                {["Unlimited AI coaching","Training analytics & trends"].map(f => (
                  <div key={f} className="ld-pricing-feat"><span className="ld-pfeat-cross">✗</span><span style={{ color: "var(--gray-400)" }}>{f}</span></div>
                ))}
              </div>
              <div className="ld-pricing-cta"><button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={goSignup}>Get started free</button></div>
            </div>

            {/* Pro */}
            <div className="ld-pricing-card featured">
              <div className="ld-pricing-popular">Most popular</div>
              <div className="ld-pricing-name">Pro</div>
              <div className="ld-pricing-desc">Unlimited AI coaching and deep training analytics for serious athletes.</div>
              <div className="ld-pricing-price"><span className="ld-pricing-amount">$9</span><span className="ld-pricing-period">/ month</span></div>
              <div className="ld-pricing-billed">Billed annually — or $12/mo monthly</div>
              <div className="ld-pricing-divider"/>
              <div className="ld-pricing-features">
                {["Everything in Free","Unlimited AI coach analyses","Full training analytics & trends","Training load & recovery scoring","Unlimited follows & connections","Unlimited active challenges","Priority event matching","Export your data anytime"].map(f => (
                  <div key={f} className="ld-pricing-feat"><span className="ld-pfeat-tick">✓</span>{f === "Unlimited AI coach analyses" ? <strong>{f}</strong> : f}</div>
                ))}
              </div>
              <div className="ld-pricing-cta"><button className="btn btn-yellow" style={{ width: "100%", justifyContent: "center", fontWeight: 600 }} onClick={goSignup}>Start Pro free for 14 days →</button></div>
            </div>

            {/* Club */}
            <div className="ld-pricing-card">
              <div className="ld-pricing-name">Club</div>
              <div className="ld-pricing-desc">For running clubs, cycling teams, gyms, and sports organisations.</div>
              <div className="ld-pricing-price"><span className="ld-pricing-amount">$29</span><span className="ld-pricing-period">/ month</span></div>
              <div className="ld-pricing-billed">Up to 25 members — $1/mo per additional member</div>
              <div className="ld-pricing-divider"/>
              <div className="ld-pricing-features">
                {["Everything in Pro for all members","Club dashboard & group feed","Coach oversight of member stats","Private club leaderboards","Bulk event sign-ups","Club challenges & points","Dedicated support"].map(f => (
                  <div key={f} className="ld-pricing-feat"><span className="ld-pfeat-tick">✓</span>{f}</div>
                ))}
              </div>
              <div className="ld-pricing-cta"><button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={goSignup}>Start Club trial</button></div>
            </div>

          </div>
          <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--gray-500)" }}>All plans include a 14-day free trial · Cancel anytime · No long-term contracts</div>
        </div>
      </div>

      {/* ── FOR CLUBS ── */}
      <div className="ld-for-clubs" id="for-clubs">
        <div className="ld-for-clubs-inner">
          <div className="ld-clubs-left">
            <div className="ld-section-label">For clubs & teams</div>
            <div className="ld-section-title" style={{ maxWidth: 380 }}>The team dashboard your club has been waiting for</div>
            <p style={{ fontSize: 15, color: "var(--gray-500)", lineHeight: 1.7, marginBottom: 28, maxWidth: 380 }}>Whether you run a parkrun group, a cycling collective, or a multi-sport club — Arenas gives coaches and organisers a single view of every member's training, events, and progress.</p>
            <button className="btn btn-primary ld-btn-lg" onClick={goSignup}>Set up your club →</button>
            <div style={{ fontSize: 13, color: "var(--gray-400)", marginTop: 10 }}>From $29/month · First month free</div>
          </div>
          <div className="ld-clubs-right">
            {[
              { icon: "📊", title: "Coach dashboard",                  desc: "See every member's weekly training load, activity streaks, and progress toward challenges — all in one place, without chasing Strava screenshots." },
              { icon: "🏆", title: "Private leaderboards & challenges", desc: "Run club-only competitions — weekly km totals, challenge streaks, or custom scoring. Points keep members engaged between events." },
              { icon: "📅", title: "Bulk event sign-ups",               desc: "Register your whole club for a race in one step. Members get a notification, the coach sees who's confirmed, and attendance is tracked automatically." },
            ].map(f => (
              <div key={f.title} className="ld-club-feat">
                <div className="ld-club-feat-icon">{f.icon}</div>
                <div className="ld-club-feat-text"><h4>{f.title}</h4><p>{f.desc}</p></div>
              </div>
            ))}
            <div className="ld-clubs-testimonial">
              <blockquote>"We moved our running club from a WhatsApp group to Arenas. The coach dashboard alone saves me two hours a week — I can see every member's training at a glance."</blockquote>
              <div className="ld-clubs-testimonial-author">
                <div className="ld-t-avatar" style={{ background: "#FFF7ED", color: "#9A3412", width: 32, height: 32, fontSize: 11 }}>RH</div>
                <div><div className="ld-t-name" style={{ fontSize: 13 }}>Rachel H.</div><div className="ld-t-sport">Head coach · Hackney Running Club</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA BAND ── */}
      <div className="ld-cta-band">
        <h2>Start for free today</h2>
        <p>Join 84,000 athletes already training smarter with Arenas.</p>
        <div className="ld-cta-band-btns">
          <button className="btn btn-yellow ld-btn-lg" onClick={goSignup} data-testid="cta-btn-signup">Create free account</button>
          <button className="btn btn-ghost ld-btn-lg" style={{ color: "var(--gray-300)", borderColor: "var(--gray-700)" }} onClick={goLogin} data-testid="cta-btn-login">Log in</button>
        </div>
      </div>

      <Footer />
    </div>
  );
}
