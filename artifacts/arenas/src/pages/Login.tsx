import { useState } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setLocation("/");
    }, 1000);
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--gray-50)", display: "flex", flexDirection: "column" }}>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" className="logo" data-testid="logo-link" onClick={(e) => { e.preventDefault(); setLocation("/"); }}>
            <div className="logo-icon">🏟</div>
            <span className="logo-text">Arenas</span>
          </a>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "24px" }}>

          <div style={{ textAlign: "center" }}>
            <div style={{ width: "48px", height: "48px", background: "var(--yellow)", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", margin: "0 auto 16px" }}>🏟</div>
            <h1 style={{ fontSize: "22px", fontWeight: 600, color: "var(--gray-900)", marginBottom: "6px" }}>Welcome back</h1>
            <p style={{ fontSize: "14px", color: "var(--gray-500)" }}>Sign in to your Arenas account</p>
          </div>

          <div style={{ background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)", padding: "28px" }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }} data-testid="form-login">

              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <button
                  type="button"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", padding: "9px 16px", border: "var(--border)", borderRadius: "8px", background: "white", fontSize: "14px", fontWeight: 500, color: "var(--gray-700)", cursor: "pointer", fontFamily: "var(--font)", transition: "background 0.1s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--gray-50)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "white")}
                  data-testid="btn-google-login"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Continue with Google
                </button>

                <button
                  type="button"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", padding: "9px 16px", border: "var(--border)", borderRadius: "8px", background: "white", fontSize: "14px", fontWeight: 500, color: "var(--gray-700)", cursor: "pointer", fontFamily: "var(--font)", transition: "background 0.1s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--gray-50)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "white")}
                  data-testid="btn-apple-login"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  Continue with Apple
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--gray-400)", fontSize: "12px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--gray-200)" }} />
                or continue with email
                <div style={{ flex: 1, height: "1px", background: "var(--gray-200)" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--gray-700)" }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  data-testid="input-email"
                  style={{ padding: "8px 12px", border: "var(--border)", borderRadius: "8px", fontSize: "14px", fontFamily: "var(--font)", outline: "none", color: "var(--gray-800)", transition: "border-color 0.15s" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "var(--gray-400)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "var(--gray-200)")}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--gray-700)" }}>Password</label>
                  <a href="#" style={{ fontSize: "12px", color: "var(--gray-500)", textDecoration: "none" }} data-testid="link-forgot-password">Forgot password?</a>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    data-testid="input-password"
                    style={{ width: "100%", padding: "8px 40px 8px 12px", border: "var(--border)", borderRadius: "8px", fontSize: "14px", fontFamily: "var(--font)", outline: "none", color: "var(--gray-800)", boxSizing: "border-box", transition: "border-color 0.15s" }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--gray-400)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--gray-200)")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    data-testid="btn-toggle-password"
                    style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--gray-400)", padding: "2px", display: "flex", alignItems: "center" }}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div data-testid="text-login-error" style={{ padding: "10px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", fontSize: "13px", color: "#DC2626" }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                data-testid="btn-submit-login"
                style={{ width: "100%", padding: "10px", fontSize: "14px", justifyContent: "center", display: "flex", alignItems: "center", gap: "8px", opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              >
                {loading && <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />}
                {loading ? "Signing in…" : "Sign in"}
              </button>

            </form>
          </div>

          <p style={{ textAlign: "center", fontSize: "13px", color: "var(--gray-500)" }}>
            Don't have an account?{" "}
            <a
              href="#"
              style={{ color: "var(--gray-900)", fontWeight: 600, textDecoration: "none" }}
              onClick={(e) => { e.preventDefault(); setLocation("/signup"); }}
              data-testid="link-signup"
            >
              Sign up free
            </a>
          </p>

        </div>
      </div>
    </div>
  );
}
