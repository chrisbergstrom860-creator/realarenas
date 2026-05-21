import { useState } from "react";

const sports = [
  { name: "All sports", color: "#6B7280", count: "312k" },
  { name: "Running", color: "#F97316", count: "88k" },
  { name: "Cycling", color: "#3B82F6", count: "64k" },
  { name: "Swimming", color: "#14B8A6", count: "29k" },
  { name: "Climbing", color: "#8B5CF6", count: "18k" },
  { name: "Football", color: "#10B981", count: "47k" },
  { name: "Basketball", color: "#EF4444", count: "21k" },
  { name: "Tennis", color: "#F59E0B", count: "14k" },
  { name: "Yoga", color: "#EC4899", count: "9k" },
];

const levels = [
  { name: "Beginner", color: "#9CA3AF", count: "102k" },
  { name: "Intermediate", color: "#60A5FA", count: "138k" },
  { name: "Advanced", color: "#F59E0B", count: "57k" },
  { name: "Elite / Pro", color: "#EF4444", count: "14k" },
];

const leaders = [
  { rank: 1, rankClass: "gold", bg: "#FEF9C3", color: "#854D0E", initials: "SL", name: "Sofia L.", sport: "Running", pts: "9,840 pts" },
  { rank: 2, rankClass: "silver", bg: "#E0F2FE", color: "#0369A1", initials: "MC", name: "Marco C.", sport: "Cycling", pts: "8,120 pts" },
  { rank: 3, rankClass: "bronze", bg: "#FCE7F3", color: "#9D174D", initials: "YT", name: "Yuki T.", sport: "Swim", pts: "7,610 pts" },
  { rank: 4, rankClass: "", bg: "#F0FDF4", color: "#166534", initials: "OB", name: "Omar B.", sport: "Basketball", pts: "6,990 pts" },
  { rank: 5, rankClass: "", bg: "#FFF7ED", color: "#9A3412", initials: "JK", name: "Jamie K.", sport: "Running", pts: "6,440 pts" },
];

export default function Sidebar() {
  const [activeSport, setActiveSport] = useState("All sports");
  const [activeLevel, setActiveLevel] = useState("");

  return (
    <aside className="sidebar">
      <div className="sidebar-card">
        <div className="sidebar-section-title">Sport</div>
        <div className="filter-group">
          {sports.map((sport) => (
            <div
              key={sport.name}
              className={`filter-item ${activeSport === sport.name ? "active" : ""}`}
              onClick={() => setActiveSport(sport.name)}
              data-testid={`filter-sport-${sport.name.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="filter-item-left">
                <div className="filter-dot" style={{ background: sport.color }}></div> {sport.name}
              </div>
              <span className="filter-count">{sport.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-card">
        <div className="sidebar-section-title">Level</div>
        <div className="filter-group">
          {levels.map((level) => (
            <div
              key={level.name}
              className={`filter-item ${activeLevel === level.name ? "active" : ""}`}
              onClick={() => setActiveLevel(activeLevel === level.name ? "" : level.name)}
              data-testid={`filter-level-${level.name.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <div className="filter-item-left">
                <div className="filter-dot" style={{ background: level.color }}></div> {level.name}
              </div>
              <span className="filter-count">{level.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-card">
        <div className="sidebar-section-title">Weekly leaders</div>
        {leaders.map((lb) => (
          <div className="lb-row" key={lb.rank}>
            <span className={`lb-rank ${lb.rankClass}`}>{lb.rank}</span>
            <div className="lb-av" style={{ background: lb.bg, color: lb.color }}>{lb.initials}</div>
            <div>
              <div className="lb-name">{lb.name}</div>
              <div className="lb-sport">{lb.sport}</div>
            </div>
            <span className="lb-pts">{lb.pts}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
