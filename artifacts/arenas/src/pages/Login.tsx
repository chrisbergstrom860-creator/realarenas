import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

type Mode = "login" | "signup";
type Step = 1 | 2 | 3;

const SPORTS_LIST = [
  { e: "🏃", l: "Running" }, { e: "🚴", l: "Cycling" }, { e: "🏊", l: "Swimming" },
  { e: "🧗", l: "Climbing" }, { e: "⚽", l: "Football" }, { e: "🏀", l: "Basketball" },
  { e: "🎾", l: "Tennis" }, { e: "🏋️", l: "Weightlifting" }, { e: "🧘", l: "Yoga" },
  { e: "🏄", l: "Surfing" }, { e: "⛷️", l: "Skiing" }, { e: "🥊", l: "Boxing" },
];

function pwScore(val: string) {
  let s = 0;
  if (val.length >= 8) s++;
  if (/[A-Z]/.test(val)) s++;
  if (/[0-9]/.test(val)) s++;
  if (/[^A-Za-z0-9]/.test(val)) s++;
  return s;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, loginAsClub } = useAuth();

  const [mode, setMode]               = useState<Mode>("login");
  const [clubMode, setClubMode]       = useState(false);
  const [step, setStep]               = useState<Step>(1);
  const [success, setSuccess]         = useState(false);

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [firstName, setFirstName]     = useState("");
  const [lastName, setLastName]       = useState("");
  const [clubName, setClubName]       = useState("");
  const [selectedSports, setSports]   = useState<string[]>([]);
  const [level, setLevel]             = useState("");
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "signup") setMode("signup");
    if (p.get("type") === "club") { setMode("signup"); setClubMode(true); }
  }, []);

  const toggleSport = (s: string) =>
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  function doLogin() {
    setLoading(true);
    setTimeout(() => { setLoading(false); login(); setSuccess(true); }, 900);
  }

  function doSignup() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (clubMode) { loginAsClub(); } else { login(); }
      setSuccess(true);
    }, 900);
  }

  function goToFeed() {
    if (clubMode) { setLocation("/club-dashboard"); }
    else { setLocation("/community"); }
  }

  const score = pwScore(password);
  const barCls = score <= 1 ? "weak" : score <= 2 ? "medium" : "strong";
  const pwLabel = password.length === 0 ? "Choose a strong password" : ["","Weak","Fair","Good","Strong"][score] || "Strong";

  const StravaSvg = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FC4C02"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
  );
  const GoogleSvg = () => (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );

  return (
    <div className="auth-page" data-testid="page-login">

      {/* Left panel */}
      <div className="auth-left">
        <div className="auth-left-top">
          {clubMode ? (
            <>
              <div className="auth-left-tagline" onClick={() => setLocation("/")} style={{ cursor: "pointer" }}>
                Your club.<br/><em>Fully coached.</em>
              </div>
              <div className="auth-left-sub">Manage members, track training load, run challenges, and get AI-powered injury risk alerts for every athlete in your club.</div>
              <div className="auth-preview">
                {[
                  { init: "RC", bg: "#FFD21E", c: "#7a5c00",  name: "Hackney RC",      sport: "Running club",   stats: ["48 members","312 km this week"] },
                  { init: "SL", bg: "#FEF9C3", c: "#854D0E",  name: "Sofia L.",         sport: "Top performer",  stats: ["88.2 km","9,840 pts"] },
                  { init: "YT", bg: "#FCE7F3", c: "#9D174D",  name: "Yuki T.",          sport: "⚠ At risk",      stats: ["68 km","Overload flagged"] },
                ].map(a => (
                  <div key={a.name} className="auth-preview-card">
                    <div className="apc-avatar" style={{ background: a.bg, color: a.c }}>{a.init}</div>
                    <div className="apc-info">
                      <div className="apc-name">{a.name} <span style={{ color: "var(--gray-500)", fontWeight: 400, fontSize: 11 }}>· {a.sport}</span></div>
                      <div className="apc-stats">{a.stats.map(s => <div key={s} className="apc-stat">{s}</div>)}</div>
                    </div>
                    <div className="ai-tag-dark">✦ AI monitored</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="auth-left-tagline" onClick={() => setLocation("/")} style={{ cursor: "pointer" }}>
                Every sport.<br/><em>One community.</em>
              </div>
              <div className="auth-left-sub">Share workouts, get AI coaching, discover events, and connect with athletes across every sport.</div>
              <div className="auth-preview">
                {[
                  { init: "JK", bg: "#FFF7ED", c: "#9A3412", name: "Jamie K.",  sport: "Running",  stats: ["12.4 km","4:23/km","148 bpm"] },
                  { init: "SR", bg: "#F5F3FF", c: "#6D28D9", name: "Sofia R.",  sport: "Climbing", stats: ["V7 sent ✓","3-wk project"] },
                  { init: "MC", bg: "#FEF9C3", c: "#854D0E", name: "Marco C.", sport: "Cycling",   stats: ["88 km","241W avg","1,240m"] },
                ].map(a => (
                  <div key={a.name} className="auth-preview-card">
                    <div className="apc-avatar" style={{ background: a.bg, color: a.c }}>{a.init}</div>
                    <div className="apc-info">
                      <div className="apc-name">{a.name} <span style={{ color: "var(--gray-500)", fontWeight: 400, fontSize: 11 }}>· {a.sport}</span></div>
                      <div className="apc-stats">{a.stats.map(s => <div key={s} className="apc-stat">{s}</div>)}</div>
                    </div>
                    <div className="ai-tag-dark">✦ AI analysed</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="auth-left-stats">
          {clubMode
            ? [["1,200","Clubs"],["48k","Members managed"],["94%","Avg challenge rate"]].map(([n,l]) => (
                <div key={l} className="auth-ls"><div className="n">{n}</div><div className="l">{l}</div></div>
              ))
            : [["84k","Athletes"],["47","Sports"],["2.1k","Events"]].map(([n,l]) => (
                <div key={l} className="auth-ls"><div className="n">{n}</div><div className="l">{l}</div></div>
              ))
          }
        </div>
      </div>

      {/* Right panel */}
      <div className="auth-right">
        <div className="auth-form-wrap">

          {success ? (
            <div className="auth-success">
              <div className="success-icon">{clubMode ? "🏟" : "🎉"}</div>
              <h3>{clubMode ? "Club dashboard ready!" : "You're in!"}</h3>
              <p>{clubMode
                ? `Welcome, ${firstName || "Coach"}. Your club dashboard is set up — let's start managing your athletes.`
                : "Welcome to Arenas. Your account is ready — let's take you to your personalised feed."
              }</p>
              <button className="btn btn-yellow btn-full ld-btn-lg" onClick={goToFeed} data-testid="btn-go-to-feed">
                {clubMode ? "Go to club dashboard →" : "Go to my feed →"}
              </button>
            </div>
          ) : (
            <>
              <div className="auth-mode-toggle">
                <button className={`auth-mode-btn${mode === "login" ? " active" : ""}`} onClick={() => { setMode("login"); setStep(1); }} data-testid="toggle-login">Log in</button>
                <button className={`auth-mode-btn${mode === "signup" ? " active" : ""}`} onClick={() => { setMode("signup"); setStep(1); }} data-testid="toggle-signup">Sign up</button>
              </div>

              {/* Club mode toggle */}
              {mode === "signup" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: clubMode ? "var(--yellow-light)" : "var(--gray-50)", border: `1px solid ${clubMode ? "#fde68a" : "var(--gray-200)"}`, borderRadius: 8, marginBottom: 16, cursor: "pointer" }} onClick={() => { setClubMode(v => !v); setStep(1); }}>
                  <span style={{ fontSize: 16 }}>{clubMode ? "🏟" : "🧑‍💼"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: clubMode ? "#7a5c00" : "var(--gray-800)" }}>{clubMode ? "Signing up as a club" : "Signing up as an athlete"}</div>
                    <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{clubMode ? "Switch to athlete signup →" : "Setting up for a club? Switch here →"}</div>
                  </div>
                  <div style={{ width: 32, height: 18, borderRadius: 9, background: clubMode ? "#FFD21E" : "var(--gray-300)", position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                    <div style={{ position: "absolute", top: 2, left: clubMode ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", transition: "left 0.2s" }}/>
                  </div>
                </div>
              )}

              {mode === "login" && (
                <div>
                  <div className="auth-title">Welcome back</div>
                  <div className="auth-subtitle">Log in to your Arenas account</div>
                  <div className="social-btns">
                    <button className="social-btn strava-btn" data-testid="btn-strava-login"><StravaSvg/> Continue with Strava</button>
                    <button className="social-btn" data-testid="btn-google-login"><GoogleSvg/> Continue with Google</button>
                  </div>
                  <div className="auth-divider"><span>or log in with email</span></div>
                  <form onSubmit={e => { e.preventDefault(); doLogin(); }} data-testid="form-login">
                    <div className="form-field">
                      <label className="form-label">Email</label>
                      <input type="email" className="form-input" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required data-testid="input-email"/>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Password <a href="#" className="form-forgot" onClick={e => e.preventDefault()}>Forgot password?</a></label>
                      <input type="password" className="form-input" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required data-testid="input-password"/>
                    </div>
                    <div className="form-submit">
                      <button type="submit" className="btn btn-primary btn-full ld-btn-lg" disabled={loading} data-testid="btn-login-submit">{loading ? "Logging in…" : "Log in to Arenas"}</button>
                    </div>
                  </form>
                  <div className="form-terms" style={{ marginTop: 16 }}>Don't have an account? <a href="#" onClick={e => { e.preventDefault(); setMode("signup"); }}>Sign up free</a></div>
                </div>
              )}

              {mode === "signup" && (
                <div>
                  <div className="onboard-progress">
                    <div className={`onboard-dot${step === 1 ? " active" : " done"}`}/>
                    <div className={`onboard-dot${step === 2 ? " active" : step > 2 ? " done" : ""}`}/>
                    <div className={`onboard-dot${step === 3 ? " active" : ""}`}/>
                  </div>

                  {step === 1 && (
                    <div className="onboard-step active" data-testid="signup-step-1">
                      <div className="auth-title">{clubMode ? "Set up your club" : "Create your account"}</div>
                      <div className="auth-subtitle">{clubMode ? "Get your club on Arenas in 2 minutes" : "Join 84,000 athletes on Arenas"}</div>
                      {!clubMode && (
                        <>
                          <div className="social-btns">
                            <button className="social-btn strava-btn" data-testid="btn-strava-signup"><StravaSvg/> Sign up with Strava</button>
                            <button className="social-btn" data-testid="btn-google-signup"><GoogleSvg/> Sign up with Google</button>
                          </div>
                          <div className="auth-divider"><span>or sign up with email</span></div>
                        </>
                      )}
                      <form onSubmit={e => { e.preventDefault(); setStep(2); }} data-testid="form-signup-step1">
                        {clubMode && (
                          <div className="form-field">
                            <label className="form-label">Club name *</label>
                            <input type="text" className="form-input" placeholder="e.g. Hackney Running Club" value={clubName} onChange={e => setClubName(e.target.value)} required/>
                          </div>
                        )}
                        <div className="form-row">
                          <div className="form-field"><label className="form-label">{clubMode ? "Your first name" : "First name"}</label><input type="text" className="form-input" placeholder="Jamie" value={firstName} onChange={e => setFirstName(e.target.value)} required/></div>
                          <div className="form-field"><label className="form-label">Last name</label><input type="text" className="form-input" placeholder="King" value={lastName} onChange={e => setLastName(e.target.value)} required/></div>
                        </div>
                        <div className="form-field"><label className="form-label">Email</label><input type="email" className="form-input" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required/></div>
                        <div className="form-field">
                          <label className="form-label">Password</label>
                          <input type="password" className="form-input" placeholder="Min 8 characters" value={password} onChange={e => setPassword(e.target.value)} required/>
                          <div className="pw-strength">
                            {[0,1,2,3].map(i => <div key={i} className={`pw-bar${i < score ? ` ${barCls}` : ""}`}/>)}
                          </div>
                          <div className="pw-label" style={{ color: score === 0 ? "var(--gray-400)" : score <= 1 ? "#EF4444" : score <= 2 ? "#F59E0B" : "#10B981" }}>{pwLabel}</div>
                        </div>
                        <div className="form-submit"><button type="submit" className="btn btn-primary btn-full ld-btn-lg" data-testid="btn-signup-continue1">Continue →</button></div>
                        <div className="form-terms">By signing up you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a></div>
                      </form>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="onboard-step active" data-testid="signup-step-2">
                      {clubMode ? (
                        <>
                          <div className="auth-title">Club sport &amp; size</div>
                          <div className="auth-subtitle">We'll set up the right tools for your sport.</div>
                          <div className="form-field">
                            <label className="form-label">Primary sport(s)</label>
                            <div className="sport-selector">
                              {SPORTS_LIST.map(s => (
                                <button key={s.l} type="button" className={`sport-select-chip${selectedSports.includes(s.l) ? " selected" : ""}`} onClick={() => toggleSport(s.l)}>{s.e} {s.l}</button>
                              ))}
                            </div>
                          </div>
                          <div className="form-field" style={{ marginTop: 16 }}>
                            <label className="form-label">Club size</label>
                            <select className="form-input" value={level} onChange={e => setLevel(e.target.value)}>
                              <option value="">Select approximate size</option>
                              <option>Small — under 20 members</option>
                              <option>Medium — 20 to 100 members</option>
                              <option>Large — 100 to 500 members</option>
                              <option>Organisation — 500+ members</option>
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="auth-title">Your sports</div>
                          <div className="auth-subtitle">Pick the sports you train in — we'll personalise your feed.</div>
                          <div className="form-field">
                            <label className="form-label">Select all that apply</label>
                            <div className="sport-selector">
                              {SPORTS_LIST.map(s => (
                                <button key={s.l} type="button" className={`sport-select-chip${selectedSports.includes(s.l) ? " selected" : ""}`} onClick={() => toggleSport(s.l)}>{s.e} {s.l}</button>
                              ))}
                            </div>
                          </div>
                          <div className="form-field" style={{ marginTop: 16 }}>
                            <label className="form-label">Your level</label>
                            <select className="form-input" value={level} onChange={e => setLevel(e.target.value)}>
                              <option value="">Select your level</option>
                              <option>Beginner — just getting started</option>
                              <option>Intermediate — training regularly</option>
                              <option>Advanced — competing or racing</option>
                              <option>Elite / Professional</option>
                            </select>
                          </div>
                        </>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep(1)}>← Back</button>
                        <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={() => setStep(3)} data-testid="btn-signup-continue2">Continue →</button>
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div className="onboard-step active" data-testid="signup-step-3">
                      {clubMode ? (
                        <>
                          <div className="auth-title">Connect &amp; invite</div>
                          <div className="auth-subtitle">Sync your data or invite members straight away.</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "20px 0" }}>
                            {[
                              { icon: "🔶", name: "Strava Club sync",    sub: "Import your existing Strava club members", btnStyle: { color: "#FC4C02", borderColor: "#FC4C02" } },
                              { icon: "📧", name: "Invite by email",     sub: "Paste a list of member emails",             btnStyle: {} },
                              { icon: "🔗", name: "Share join link",     sub: "Members sign up via your unique link",     btnStyle: {} },
                            ].map(d => (
                              <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: "var(--border)", borderRadius: 9, background: "white" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ fontSize: 18 }}>{d.icon}</span>
                                  <div><div style={{ fontSize: 14, fontWeight: 600, color: "var(--gray-900)" }}>{d.name}</div><div style={{ fontSize: 12, color: "var(--gray-500)" }}>{d.sub}</div></div>
                                </div>
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", ...d.btnStyle }}>Connect</button>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="auth-title">Connect your devices</div>
                          <div className="auth-subtitle">Sync activities automatically — no manual logging needed.</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "20px 0" }}>
                            {[
                              { icon: "🔶", name: "Strava",         sub: "Sync runs, rides, swims & more",  btnStyle: { color: "#FC4C02", borderColor: "#FC4C02" } },
                              { icon: "⌚", name: "Garmin Connect", sub: "Sync GPS data and heart rate",     btnStyle: {} },
                              { icon: "🍎", name: "Apple Health",   sub: "Workouts, steps and activity",    btnStyle: {} },
                            ].map(d => (
                              <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: "var(--border)", borderRadius: 9, background: "white" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ fontSize: 18 }}>{d.icon}</span>
                                  <div><div style={{ fontSize: 14, fontWeight: 600, color: "var(--gray-900)" }}>{d.name}</div><div style={{ fontSize: 12, color: "var(--gray-500)" }}>{d.sub}</div></div>
                                </div>
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", ...d.btnStyle }}>Connect</button>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setStep(2)}>← Back</button>
                        <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={doSignup} disabled={loading} data-testid="btn-signup-finish">{loading ? "Creating account…" : clubMode ? "Launch dashboard →" : "Finish setup →"}</button>
                      </div>
                      <div style={{ textAlign: "center", marginTop: 10 }}>
                        <a href="#" style={{ fontSize: 12, color: "var(--gray-400)", textDecoration: "none" }} onClick={e => { e.preventDefault(); doSignup(); }}>Skip for now</a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
