import { useState } from "react";
import Topbar from "../components/Topbar";
import Hero from "../components/Hero";
import TabsBar from "../components/TabsBar";
import Sidebar from "../components/Sidebar";
import FeaturedAthletes from "../components/FeaturedAthletes";
import ActivityCard from "../components/ActivityCard";
import UpcomingEvents from "../components/UpcomingEvents";
import TrendingTopics from "../components/TrendingTopics";
import Footer from "../components/Footer";

const activitiesData = [
  {
    id: "1",
    sport: "Running",
    athlete: "Jamie K.",
    headerUser: "Jamie K.",
    sportEmoji: "🏃",
    timeLoc: "7 min ago · London, UK",
    avatar: { bg: "#FFF7ED", color: "#9A3412", initials: "JK" },
    stats: { "12.4": "km", "54:22": "time", "4:23": "/ km", "148": "avg bpm", "+312": "elev m" },
    body: "Morning long run ✓ Legs felt heavy but pushed through miles 8–10. PB attempt next Sunday — anyone in London want to pace the last 5k?",
    kudos: 24,
    comments: 8,
    routeLabel: "View route",
    note: "Legs felt heavy, struggled miles 8-10, planning a PB attempt next Sunday",
    quickPrompts: ['How can I improve my pace?', 'Was my heart rate too high?', 'Recovery tips for Sunday?', 'What does this pace mean for a half marathon?']
  },
  {
    id: "2",
    sport: "Climbing",
    athlete: "Sofia R.",
    headerUser: "Sofia R.",
    sportEmoji: "🧗",
    timeLoc: "22 min ago · Barcelona",
    avatar: { bg: "#F5F3FF", color: "#6D28D9", initials: "SR" },
    stats: { "V7": "grade", "3 wks": "project time", "Sent ✓": "status", "2h 10m": "session" },
    body: "Finally sent the V7 I've been projecting at Montserrat. Crux is the undercling right before the lip. Full send video linked — beta in comments for anyone working this problem.",
    kudos: 61,
    comments: 19,
    routeLabel: "Save",
    note: "Sent V7 bouldering problem at Montserrat, crux was an undercling near the top",
    quickPrompts: ['What should I project next?', 'How do I train for V8?', 'Tips for undercling moves?', 'How long should I rest before next session?']
  },
  {
    id: "3",
    sport: "Cycling",
    athlete: "Marco C.",
    headerUser: "Marco C.",
    sportEmoji: "🚴",
    timeLoc: "1h ago · Milan",
    avatar: { bg: "#FEF9C3", color: "#854D0E", initials: "MC" },
    stats: { "88": "km", "2h 41m": "time", "32.7": "km/h", "1,240": "elev m", "241": "avg watt" },
    body: "Saturday climb group is open this weekend — we'll hit the Stelvio approach from Prato allo Stelvio. DM to join, cap at 12 riders. Café stop at the summit.",
    kudos: 37,
    comments: 14,
    routeLabel: "View route",
    note: "Mountain ride, Stelvio approach, planning group ride this Saturday",
    quickPrompts: ['How does my power output compare?', 'Tips for climbing efficiency?', 'Nutrition for long climbs?', 'How to train for Granfondo?']
  }
];

const groupsData = [
  { id: "g1", emoji: "🏃", name: "London Runners Club", members: "2.3k members", sport: "Running", desc: "Weekly group runs across London parks. All paces welcome. Saturday long run at 7am from Victoria Park.", tags: ["Running", "Beginner", "Community"] },
  { id: "g2", emoji: "🚴", name: "Milan Cycling Collective", members: "1.1k members", sport: "Cycling", desc: "Road & gravel rides in and around Milan. Weekend Gran Fondo prep rides. Marco C. leads the Sunday climbs.", tags: ["Cycling", "Advanced", "Gravel"] },
  { id: "g3", emoji: "🧗", name: "Barcelona Boulders", members: "480 members", sport: "Climbing", desc: "Indoor & outdoor sessions in and around Barcelona. Monthly trips to Montserrat. Beta sharing welcome.", tags: ["Climbing", "Intermediate"] },
  { id: "g4", emoji: "🏊", name: "Geneva Open Water", members: "310 members", sport: "Swimming", desc: "Open water swimming in Lake Geneva. Training for the 5K race in April. Cold water acclimatisation sessions.", tags: ["Swimming", "Advanced"] },
  { id: "g5", emoji: "⚽", name: "5-a-side League Berlin", members: "890 members", sport: "Football", desc: "Casual and competitive 5-a-side football in Berlin. Season running April–September. All skill levels.", tags: ["Football", "Community"] },
  { id: "g6", emoji: "🎾", name: "Paris Tennis Circle", members: "220 members", sport: "Tennis", desc: "Social tennis and match play in Paris. Weekly ladder and monthly tournaments. Clay court specialists.", tags: ["Tennis", "Intermediate"] },
];

const challengesData = [
  { id: "c1", emoji: "🏃", title: "May 100km Running Challenge", sport: "Running", desc: "Log 100km of running across the entire month of May. Track your progress daily.", participants: "6,210", daysLeft: 10, joined: false },
  { id: "c2", emoji: "🚴", title: "Stelvio Climb Challenge", sport: "Cycling", desc: "Accumulate 3,000m of climbing on the bike in one week. Inspired by the Granfondo Stelvio route.", participants: "1,840", daysLeft: 4, joined: true },
  { id: "c3", emoji: "🧗", title: "Send a New Grade Challenge", sport: "Climbing", desc: "Send a problem or route one grade above your current level this month. Log it with proof.", participants: "980", daysLeft: 10, joined: false },
  { id: "c4", emoji: "🏊", title: "Open Water Prep 10K", sport: "Swimming", desc: "Log 10km of total swimming distance in April to prepare for the Open Water 5K race.", participants: "450", daysLeft: 0, joined: false },
  { id: "c5", emoji: "🧘", title: "30-Day Yoga Streak", sport: "Yoga", desc: "Complete at least 20 minutes of yoga every day for 30 days. Rest days don't count!", participants: "2,100", daysLeft: 17, joined: true },
  { id: "c6", emoji: "⭐", title: "All-Sports Triathlon Week", sport: "Multi-sport", desc: "Complete a run, a ride, and a swim in the same week. Bonus points for logging all three.", participants: "3,300", daysLeft: 4, joined: false },
];

function PlaceholderGroups() {
  return (
    <div>
      <div className="section-header">
        <h2>Discover groups</h2>
        <a href="#">View all →</a>
      </div>
      <div className="cards-grid wide">
        {groupsData.map(g => (
          <div className="card" key={g.id} data-testid={`card-group-${g.id}`}>
            <div className="card-top">
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <div className="card-avatar" style={{ background: "#F3F4F6", fontSize: "20px" }}>{g.emoji}</div>
                <div>
                  <div className="card-title">{g.name}</div>
                  <div className="card-author">{g.members} · {g.sport}</div>
                </div>
              </div>
            </div>
            <div className="card-desc">{g.desc}</div>
            <div className="card-tags">
              {g.tags.map(t => <span key={t} className={`tag ${t === g.sport ? "sport" : ""}`}>{t}</span>)}
            </div>
            <div className="card-footer">
              <div />
              <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 12px" }} data-testid={`btn-join-group-${g.id}`}>+ Join group</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceholderChallenges() {
  return (
    <div>
      <div className="section-header">
        <h2>Active challenges</h2>
        <a href="#">View all →</a>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {challengesData.map(c => (
          <div className="activity-card" key={c.id} data-testid={`card-challenge-${c.id}`}>
            <div className="activity-card-body">
              <div className="act-header">
                <div className="act-avatar" style={{ background: "#F3F4F6", fontSize: "18px" }}>{c.emoji}</div>
                <div className="act-meta">
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <div className="act-user">{c.title}</div>
                    <span className="tag sport" style={{ fontSize: "10px" }}>{c.sport}</span>
                  </div>
                  <div className="act-time">
                    {c.daysLeft > 0 ? `${c.daysLeft} days left` : "Ended"} · {c.participants} participants
                  </div>
                </div>
              </div>
              <div className="act-body">{c.desc}</div>
              <div className="act-actions">
                {c.joined
                  ? <button className="act-btn liked" data-testid={`btn-joined-${c.id}`}>✓ Joined</button>
                  : <button className="act-btn" data-testid={`btn-join-challenge-${c.id}`}>+ Join challenge</button>
                }
                <button className="act-btn" data-testid={`btn-share-${c.id}`}>📤 Share</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Community() {
  const [activeTab, setActiveTab] = useState("Activities");

  return (
    <>
      <Topbar />
      <Hero />
      <TabsBar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="main">
        <Sidebar />
        <div className="grid-wrap">

          {activeTab === "Activities" && (
            <>
              <FeaturedAthletes />
              <div>
                <div className="section-header" style={{ marginTop: "8px" }}>
                  <h2>Recent activities</h2>
                  <a href="#">View all →</a>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {activitiesData.map(act => (
                    <ActivityCard key={act.id} data={act} />
                  ))}
                </div>
              </div>
              <UpcomingEvents />
              <TrendingTopics />
            </>
          )}

          {activeTab === "Athletes" && (
            <>
              <FeaturedAthletes />
              <div>
                <div className="section-header" style={{ marginTop: "8px" }}>
                  <h2>Most active this week</h2>
                  <a href="#">View all →</a>
                </div>
                <div className="cards-grid">
                  {[
                    { emoji: "🏃", bg: "#FFF7ED", name: "Jamie K.", loc: "London · 640 followers", desc: "Consistent mileage logger and PB chaser. London marathon circuit regular.", tags: ["Running", "Intermediate"], acts: "48 activities", pts: "6,440 pts", time: "Active today" },
                    { emoji: "🏊", bg: "#E0F2FE", name: "Yuki T.", loc: "Tokyo · 520 followers", desc: "Open water swimmer preparing for Geneva 5K. Pool and sea sessions weekly.", tags: ["Swimming", "Advanced"], acts: "31 activities", pts: "7,610 pts", time: "3h ago" },
                    { emoji: "⚽", bg: "#F0FDF4", name: "Omar B.", loc: "Berlin · 390 followers", desc: "5-a-side captain and recreational footballer. Organises the Berlin street league.", tags: ["Football", "Beginner"], acts: "26 activities", pts: "6,990 pts", time: "1d ago" },
                  ].map(a => (
                    <div className="card" key={a.name} data-testid={`card-athlete-${a.name.replace(" ", "-").toLowerCase()}`}>
                      <div className="card-top">
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <div className="card-avatar" style={{ background: a.bg }}>{a.emoji}</div>
                          <div>
                            <div className="card-title">{a.name}</div>
                            <div className="card-author">{a.loc}</div>
                          </div>
                        </div>
                      </div>
                      <div className="card-desc">{a.desc}</div>
                      <div className="card-tags">{a.tags.map(t => <span key={t} className="tag sport">{t}</span>)}</div>
                      <div className="card-footer">
                        <div className="card-footer-left">
                          <div className="card-stat">🔥 {a.acts}</div>
                          <div className="card-stat">⭐ {a.pts}</div>
                        </div>
                        <div className="card-updated">{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === "Groups" && <PlaceholderGroups />}

          {activeTab === "Events" && <UpcomingEvents expanded />}

          {activeTab === "Challenges" && <PlaceholderChallenges />}

        </div>
      </main>
      <Footer />
    </>
  );
}
