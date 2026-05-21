import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  
  // Sign up step state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  
  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [location, setLocationField] = useState("");
  const [level, setLevel] = useState("");
  
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const m = urlParams.get('mode');
    if (m === 'signup') {
      setMode('signup');
    }
  }, []);

  const sportsList = [
    "Running", "Cycling", "Swimming", "Climbing", 
    "Football", "Basketball", "Tennis", "Yoga", 
    "Weightlifting", "Boxing", "Surfing", "Skiing"
  ];

  const toggleSport = (sport: string) => {
    if (selectedSports.includes(sport)) {
      setSelectedSports(selectedSports.filter(s => s !== sport));
    } else {
      setSelectedSports([...selectedSports, sport]);
    }
  };

  const getPasswordStrength = () => {
    const len = password.length;
    if (len === 0) return 0;
    if (len < 6) return 1;
    if (len < 10) return 2;
    return 4;
  };

  const renderPasswordBars = () => {
    const strength = getPasswordStrength();
    return (
      <div className="pw-strength">
        <div className={`pw-bar ${strength >= 1 ? (strength === 1 ? 'weak' : strength === 2 ? 'medium' : 'strong') : ''}`}></div>
        <div className={`pw-bar ${strength >= 2 ? (strength === 2 ? 'medium' : 'strong') : ''}`}></div>
        <div className={`pw-bar ${strength >= 2 ? (strength === 2 ? 'medium' : 'strong') : ''}`}></div>
        <div className={`pw-bar ${strength >= 4 ? 'strong' : ''}`}></div>
      </div>
    );
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setLocation("/profile");
    }, 1000);
  };

  const handleSignupStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(2);
  };

  const handleSignupStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(3);
  };

  const handleSignupComplete = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setLocation("/profile");
    }, 1000);
  };

  return (
    <div className="page active auth-page" data-testid="page-login">
      {/* Left panel */}
      <div className="auth-left">
        <div className="auth-left-top">
          <div className="auth-left-tagline" onClick={() => setLocation("/")} style={{cursor: "pointer"}}>Every sport.<br/><em>One community.</em></div>
          <div className="auth-left-sub">Join the platform where multi-sport athletes track their training, discover events, and connect.</div>
          
          <div className="auth-preview">
            <div className="auth-preview-card">
              <div className="apc-avatar" style={{background: "#FFF7ED", color: "#9A3412"}}>JK</div>
              <div className="apc-info">
                <div className="apc-name">Jamie K. <span style={{fontWeight: "normal", color: "var(--gray-400)", fontSize: "12px"}}>— Running</span></div>
                <div className="apc-stats" style={{marginTop: "4px"}}>
                  <div className="apc-stat">12.4 km</div>
                  <div className="apc-stat">4:23/km</div>
                  <div className="apc-stat">148 bpm</div>
                </div>
              </div>
              <div className="ai-glow" style={{background: "rgba(255,249,224,0.1)", borderColor: "rgba(253,230,138,0.2)", color: "#FFD21E"}}>✦ AI analysed</div>
            </div>
            
            <div className="auth-preview-card">
              <div className="apc-avatar" style={{background: "#F5F3FF", color: "#6D28D9"}}>SR</div>
              <div className="apc-info">
                <div className="apc-name">Sofia R. <span style={{fontWeight: "normal", color: "var(--gray-400)", fontSize: "12px"}}>— Climbing</span></div>
                <div className="apc-stats" style={{marginTop: "4px"}}>
                  <div className="apc-stat">V7 sent</div>
                  <div className="apc-stat">3 wk project</div>
                </div>
              </div>
            </div>

            <div className="auth-preview-card">
              <div className="apc-avatar" style={{background: "#FEF9C3", color: "#854D0E"}}>MC</div>
              <div className="apc-info">
                <div className="apc-name">Marco C. <span style={{fontWeight: "normal", color: "var(--gray-400)", fontSize: "12px"}}>— Cycling</span></div>
                <div className="apc-stats" style={{marginTop: "4px"}}>
                  <div className="apc-stat">88 km</div>
                  <div className="apc-stat">241W avg</div>
                  <div className="apc-stat">1,240m</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-left-stats">
          <div className="auth-ls">
            <div className="n">84k</div>
            <div className="l">Athletes</div>
          </div>
          <div className="auth-ls">
            <div className="n">47</div>
            <div className="l">Sports</div>
          </div>
          <div className="auth-ls">
            <div className="n">2.1k</div>
            <div className="l">Events</div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="auth-right">
        <div className="auth-form-wrap">
          
          <div className="auth-mode-toggle">
            <button 
              className={`auth-mode-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => { setMode('login'); setStep(1); }}
              data-testid="toggle-login"
            >Log in</button>
            <button 
              className={`auth-mode-btn ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => { setMode('signup'); setStep(1); }}
              data-testid="toggle-signup"
            >Sign up</button>
          </div>

          {mode === 'login' && (
            <div id="login-form">
              <div className="auth-title">Welcome back</div>
              <div className="auth-subtitle">Log in to your Arenas account</div>

              <div className="social-btns">
                <button className="social-btn strava-btn" data-testid="btn-strava-login">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                  Log in with Strava
                </button>
                <button className="social-btn" data-testid="btn-google-login">
                  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Log in with Google
                </button>
              </div>

              <div className="auth-divider"><span>or log in with email</span></div>

              <form onSubmit={handleLoginSubmit} data-testid="form-login">
                <div className="form-field">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required data-testid="input-login-email"/>
                </div>
                <div className="form-field">
                  <div style={{display: "flex", justifyContent: "space-between", marginBottom: "5px"}}>
                    <label className="form-label" style={{marginBottom: 0}}>Password</label>
                    <a href="#" className="form-forgot">Forgot password?</a>
                  </div>
                  <div style={{position: "relative"}}>
                    <input type={showPassword ? "text" : "password"} className="form-input" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required data-testid="input-login-password"/>
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--gray-400)"}}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                <button type="submit" className="btn btn-primary btn-full form-submit" disabled={loading} data-testid="btn-login-submit">
                  {loading ? "Logging in..." : "Log in to Arenas"}
                </button>
              </form>

              <div style={{textAlign: "center", marginTop: "24px", fontSize: "13px", color: "var(--gray-500)"}}>
                Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }} style={{color: "var(--gray-900)", fontWeight: 600}}>Sign up free</a>
              </div>
            </div>
          )}

          {mode === 'signup' && (
            <div id="signup-form">
              <div className="onboard-progress">
                <div className={`onboard-dot ${step === 1 ? 'active' : 'done'}`}></div>
                <div className={`onboard-dot ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}></div>
                <div className={`onboard-dot ${step === 3 ? 'active' : ''}`}></div>
              </div>

              {step === 1 && (
                <div className="onboard-step active">
                  <div className="auth-title">Create your account</div>
                  <div className="auth-subtitle">Join 84,000 athletes on Arenas</div>

                  <div className="social-btns">
                    <button className="social-btn strava-btn" data-testid="btn-strava-signup">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                      Sign up with Strava
                    </button>
                    <button className="social-btn" data-testid="btn-google-signup">
                      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      Sign up with Google
                    </button>
                  </div>

                  <div className="auth-divider"><span>or sign up with email</span></div>

                  <form onSubmit={handleSignupStep1} data-testid="form-signup-step1">
                    <div className="form-row">
                      <div className="form-field">
                        <label className="form-label">First name</label>
                        <input type="text" className="form-input" placeholder="Jamie" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                      </div>
                      <div className="form-field">
                        <label className="form-label">Last name</label>
                        <input type="text" className="form-input" placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} required />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Email</label>
                      <input type="email" className="form-input" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Password</label>
                      <input type="password" className="form-input" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
                      {renderPasswordBars()}
                    </div>
                    <button type="submit" className="btn btn-primary btn-full form-submit" data-testid="btn-signup-step1">Continue →</button>
                    <div className="form-terms">
                      By continuing, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
                    </div>
                  </form>
                </div>
              )}

              {step === 2 && (
                <div className="onboard-step active">
                  <div className="auth-title">Your sports</div>
                  <div className="auth-subtitle">Pick the sports you train in — we'll personalise your feed.</div>
                  
                  <form onSubmit={handleSignupStep2} data-testid="form-signup-step2">
                    <div className="form-field">
                      <label className="form-label" style={{marginBottom: "12px"}}>Select all that apply</label>
                      <div className="sport-selector">
                        {sportsList.map(sport => (
                          <div 
                            key={sport} 
                            className={`sport-select-chip ${selectedSports.includes(sport) ? 'selected' : ''}`}
                            onClick={() => toggleSport(sport)}
                          >
                            {selectedSports.includes(sport) ? '✓ ' : '+ '}{sport}
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary btn-full form-submit" style={{marginTop: "32px"}} data-testid="btn-signup-step2" disabled={selectedSports.length === 0}>Continue →</button>
                    <div style={{textAlign: "center", marginTop: "12px"}}>
                      <a href="#" onClick={(e) => {e.preventDefault(); setStep(1)}} style={{fontSize: "13px", color: "var(--gray-500)", textDecoration: "none"}}>← Back</a>
                    </div>
                  </form>
                </div>
              )}

              {step === 3 && (
                <div className="onboard-step active">
                  <div className="auth-title">Set up your profile</div>
                  <div className="auth-subtitle">You can change these later</div>
                  
                  <form onSubmit={handleSignupComplete} data-testid="form-signup-step3">
                    <div className="form-field">
                      <label className="form-label">Where are you based?</label>
                      <input type="text" className="form-input" placeholder="e.g. London, UK" value={location} onChange={e => setLocationField(e.target.value)} required />
                    </div>
                    <div className="form-field" style={{marginTop: "20px"}}>
                      <label className="form-label" style={{marginBottom: "12px"}}>Primary fitness level</label>
                      <div className="sport-selector">
                        {['Beginner', 'Intermediate', 'Advanced', 'Elite / Pro'].map(lvl => (
                          <div 
                            key={lvl} 
                            className={`sport-select-chip ${level === lvl ? 'selected' : ''}`}
                            onClick={() => setLevel(lvl)}
                          >
                            {lvl}
                          </div>
                        ))}
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary btn-full form-submit" style={{marginTop: "32px"}} disabled={loading || !location || !level} data-testid="btn-signup-complete">
                      {loading ? "Creating account..." : "Create my account →"}
                    </button>
                    <div style={{textAlign: "center", marginTop: "12px"}}>
                      <a href="#" onClick={(e) => {e.preventDefault(); setStep(2)}} style={{fontSize: "13px", color: "var(--gray-500)", textDecoration: "none"}}>← Back</a>
                    </div>
                  </form>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}