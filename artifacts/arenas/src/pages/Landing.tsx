import { useEffect } from "react";
import { useLocation } from "wouter";
import Footer from "../components/Footer";

export default function Landing() {
  const [, setLocation] = useLocation();

  const sports = ["Running", "Cycling", "Swimming", "Climbing", "Football", "Basketball", "Tennis", "Yoga", "Weightlifting", "Boxing", "Surfing", "Skiing", "Gymnastics", "Equestrian", "Cross-country", "Ice Hockey", "Archery", "Rowing", "Golf", "Wrestling"];

  return (
    <div className="page active" id="page-landing" data-testid="page-landing">
      {/* INLINE TOPBAR */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo" onClick={() => setLocation('/')} data-testid="logo-link">
            <div className="logo-icon">🏟</div>
            <span className="logo-text">Arenas</span>
          </div>
          <nav className="topnav" id="topnav-landing">
            <a onClick={() => setLocation('/community')} data-testid="nav-community">Community</a>
            <a data-testid="nav-athletes">Athletes</a>
            <a data-testid="nav-events">Events</a>
            <a data-testid="nav-pricing">Pricing</a>
          </nav>
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={() => setLocation('/login')} data-testid="btn-login">Log in</button>
            <button className="btn btn-primary" onClick={() => setLocation('/login?mode=signup')} data-testid="btn-signup">Sign up free</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="landing-hero">
        <div className="hero-eyebrow">🏅 <span>84,000+</span> athletes across 47 sports</div>
        <h1>Every sport.<br/><em>One community.</em></h1>
        <p>Share workouts, get AI-powered coaching, discover events, and find athletes who push as hard as you do.</p>
        <div className="hero-cta">
          <button className="btn btn-yellow btn-lg" onClick={() => setLocation('/login?mode=signup')} data-testid="hero-btn-signup">Get started free →</button>
          <button className="btn btn-ghost btn-lg" onClick={() => setLocation('/login')} data-testid="hero-btn-login">Log in</button>
        </div>
        <div className="hero-note">No credit card required · Free forever plan available</div>
      </div>

      {/* Scrolling sport pills */}
      <div className="sport-scroll">
        <div className="sport-scroll-inner" id="sport-pills">
          {sports.map((s, i) => (
            <div key={`p1-${i}`} className="sport-pill">{s}</div>
          ))}
          {sports.map((s, i) => (
            <div key={`p2-${i}`} className="sport-pill">{s}</div>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stats-bar-inner">
          <div className="stat-item"><div className="stat-num">84k</div><div className="stat-label">Athletes</div><div className="stat-delta">↑ +1.2k this week</div></div>
          <div className="stat-item"><div className="stat-num">312k</div><div className="stat-label">Activities logged</div><div className="stat-delta">↑ +4.8k today</div></div>
          <div className="stat-item"><div className="stat-num">2.1k</div><div className="stat-label">Upcoming events</div><div className="stat-delta">↑ +38 this week</div></div>
          <div className="stat-item"><div className="stat-num">47</div><div className="stat-label">Sports covered</div><div className="stat-delta">↑ +2 this month</div></div>
        </div>
      </div>

      {/* Features */}
      <div className="features">
        <div className="features-inner">
          <div className="section-label">Why Arenas</div>
          <div className="section-title">Everything your training needs, in one place</div>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#FFF9E0"}}>✦</div>
              <h3>AI-powered coaching</h3>
              <p>Every activity you log gets a personalised AI analysis — pace breakdown, heart rate zones, recovery recommendations, and training suggestions grounded in your data.</p>
              <span className="feature-badge badge-ai">✦ AI Coach</span>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#F0FDF4"}}>🏟</div>
              <h3>Cross-sport community</h3>
              <p>Running, cycling, climbing, football, swimming — all in one feed. Follow athletes across sports and discover a community Strava's siloed design doesn't allow.</p>
              <span className="feature-badge badge-free">Free forever</span>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#EFF6FF"}}>📅</div>
              <h3>Event discovery</h3>
              <p>2,100+ events across 47 sports. AI matches you with events that suit your fitness profile and connects you with athletes already registered near you.</p>
              <span className="feature-badge badge-free">Free forever</span>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#FDF4FF"}}>🏆</div>
              <h3>Leaderboards & challenges</h3>
              <p>Weekly sport leaderboards, monthly challenges, and club competitions. Earn points for every activity and climb the rankings against athletes at your level.</p>
              <span className="feature-badge badge-free">Free forever</span>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#FFF7ED"}}>🔗</div>
              <h3>Strava & device sync</h3>
              <p>Connect your Strava, Garmin, Wahoo, or Apple Watch. Activities sync automatically — your stats flow straight into your Arenas feed without manual logging.</p>
              <span className="feature-badge badge-free">Free forever</span>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: "#F0FDF4"}}>📈</div>
              <h3>Training analytics</h3>
              <p>Trend analysis across weeks and months. Track your training load, spot patterns in your performance, and understand how your fitness is actually progressing.</p>
              <span className="feature-badge badge-pro">Pro feature</span>
            </div>
          </div>
        </div>
      </div>

      {/* Social proof */}
      <div className="social-proof">
        <div className="social-proof-inner">
          <div className="section-label" style={{textAlign: "center"}}>Athletes love it</div>
          <div className="section-title" style={{textAlign: "center", margin: "0 auto 0", maxWidth: "500px"}}>What the community is saying</div>
          <div className="testimonials">
            <div className="testimonial">
              <div className="stars">★★★★★</div>
              <div className="testimonial-text">"The AI coach is the reason I came back. It told me my heart rate was too high for a recovery run before I even realised — and it was right."</div>
              <div className="testimonial-author">
                <div className="t-avatar" style={{background: "#FFF7ED", color: "#9A3412"}}>JK</div>
                <div><div className="t-name">Jamie K.</div><div className="t-sport">Running · London</div></div>
              </div>
            </div>
            <div className="testimonial">
              <div className="stars">★★★★★</div>
              <div className="testimonial-text">"Finally a place where my running AND my climbing coexist. I don't have to choose which sport identity to post from."</div>
              <div className="testimonial-author">
                <div className="t-avatar" style={{background: "#F5F3FF", color: "#6D28D9"}}>SR</div>
                <div><div className="t-name">Sofia R.</div><div className="t-sport">Climbing · Barcelona</div></div>
              </div>
            </div>
            <div className="testimonial">
              <div className="stars">★★★★★</div>
              <div className="testimonial-text">"Found 8 riders for my Stelvio group through Arenas Events. Never met them before — now we ride every Saturday. That's a product doing something real."</div>
              <div className="testimonial-author">
                <div className="t-avatar" style={{background: "#FEF9C3", color: "#854D0E"}}>MC</div>
                <div><div className="t-name">Marco C.</div><div className="t-sport">Cycling · Milan</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity preview strip */}
      <div className="preview-strip">
        <div className="preview-strip-inner">
          <div className="section-label" style={{textAlign: "center"}}>Live community feed</div>
          <div className="section-title" style={{textAlign: "center", margin: "0 auto 0", maxWidth: "500px"}}>See how others are training</div>
          <div className="preview-cards">
            <div className="preview-card">
              <div className="p-avatar" style={{background: "#FFF7ED", color: "#9A3412"}}>JK</div>
              <div className="p-info">
                <div className="p-name">Jamie K. <span style={{fontWeight: "normal", color: "var(--gray-500)"}}>logged a run</span></div>
                <div className="p-desc">Morning long run — PB attempt this Sunday!</div>
              </div>
              <div className="p-stats">
                <div className="p-stat">12.4km</div><div className="p-stat">4:23/km</div><div className="p-stat">148bpm</div>
              </div>
              <div className="ai-glow">✦ AI analysed</div>
            </div>
            <div className="preview-card">
              <div className="p-avatar" style={{background: "#F5F3FF", color: "#6D28D9"}}>SR</div>
              <div className="p-info">
                <div className="p-name">Sofia R. <span style={{fontWeight: "normal", color: "var(--gray-500)"}}>logged a climb</span></div>
                <div className="p-desc">Sent the V7 project at Montserrat</div>
              </div>
              <div className="p-stats">
                <div className="p-stat">V7 sent</div><div className="p-stat">3 wk project</div>
              </div>
              <div className="ai-glow">✦ AI analysed</div>
            </div>
            <div className="preview-card">
              <div className="p-avatar" style={{background: "#FEF9C3", color: "#854D0E"}}>MC</div>
              <div className="p-info">
                <div className="p-name">Marco C. <span style={{fontWeight: "normal", color: "var(--gray-500)"}}>logged a ride</span></div>
                <div className="p-desc">Stelvio approach — group ride Saturday open</div>
              </div>
              <div className="p-stats">
                <div className="p-stat">88km</div><div className="p-stat">241W</div><div className="p-stat">1,240m</div>
              </div>
              <div className="ai-glow">✦ AI analysed</div>
            </div>
          </div>
          <div style={{textAlign: "center", marginTop: "32px"}}>
            <button className="btn btn-yellow btn-lg" onClick={() => setLocation('/login?mode=signup')} data-testid="feed-btn-signup">Join Arenas to see your feed →</button>
          </div>
        </div>
      </div>

      {/* CTA footer band */}
      <div className="cta-band">
        <h2>Start for free today</h2>
        <p>Join 84,000 athletes tracking their progress and finding their people.</p>
        <div className="cta-band-btns">
          <button className="btn btn-yellow btn-lg" onClick={() => setLocation('/login?mode=signup')} data-testid="cta-btn-signup">Create free account</button>
          <button className="btn btn-ghost btn-lg" style={{color: "white"}} onClick={() => setLocation('/login')} data-testid="cta-btn-login">Log in</button>
        </div>
      </div>

      <Footer />
    </div>
  );
}