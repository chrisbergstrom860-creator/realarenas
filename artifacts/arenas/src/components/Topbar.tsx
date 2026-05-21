import { useState } from "react";
import { useLocation } from "wouter";

export default function Topbar() {
  const [activeTab, setActiveTab] = useState("Community");
  const [, setLocation] = useLocation();
  const navTabs = ["Community", "Athletes", "Events", "Leaderboards", "Challenges"];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#" className="logo" data-testid="logo-link">
          <div className="logo-icon">🏟</div>
          <span className="logo-text">Arenas</span>
        </a>
        <nav className="topnav">
          {navTabs.map((tab) => (
            <a
              key={tab}
              href="#"
              className={activeTab === tab ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab(tab);
              }}
              data-testid={`nav-${tab.toLowerCase()}`}
            >
              {tab}
            </a>
          ))}
        </nav>
        <div className="search-wrap">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5l3.5 3.5" strokeLinecap="round" />
          </svg>
          <input type="text" placeholder="Search athletes, sports, events…" data-testid="input-search" />
        </div>
        <div className="topbar-actions">
          <a href="/login" className="btn btn-ghost" data-testid="btn-login" onClick={(e) => { e.preventDefault(); setLocation("/login"); }}>Log in</a>
          <a href="/signup" className="btn btn-primary" data-testid="btn-signup" onClick={(e) => { e.preventDefault(); setLocation("/signup"); }}>Sign up</a>
          <div className="avatar-sm" data-testid="avatar-user">JK</div>
        </div>
      </div>
    </header>
  );
}
