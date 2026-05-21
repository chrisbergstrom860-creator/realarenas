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

export default function Community() {
  return (
    <>
      <Topbar />
      <Hero />
      <TabsBar />
      <main className="main">
        <Sidebar />
        <div className="grid-wrap">
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
        </div>
      </main>
      <Footer />
    </>
  );
}
