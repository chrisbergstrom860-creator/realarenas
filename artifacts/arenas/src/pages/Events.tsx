import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import Topbar from "@/components/Topbar";
import Footer from "@/components/Footer";

const sportColors: Record<string, { bg: string; color: string; dot: string; tag: string }> = {
  running:    { bg: "#FFF7ED", color: "#9A3412", dot: "#F97316", tag: "🏃" },
  cycling:    { bg: "#EFF6FF", color: "#1D4ED8", dot: "#3B82F6", tag: "🚴" },
  swimming:   { bg: "#F0FDF4", color: "#166534", dot: "#14B8A6", tag: "🏊" },
  climbing:   { bg: "#F5F3FF", color: "#6D28D9", dot: "#8B5CF6", tag: "🧗" },
  football:   { bg: "#F0FDF4", color: "#14532D", dot: "#10B981", tag: "⚽" },
  basketball: { bg: "#FEF2F2", color: "#991B1B", dot: "#EF4444", tag: "🏀" },
  tennis:     { bg: "#FEFCE8", color: "#713F12", dot: "#F59E0B", tag: "🎾" },
  yoga:       { bg: "#FDF4FF", color: "#6B21A8", dot: "#EC4899", tag: "🧘" },
};

interface Attendee { i: string; bg: string; c: string; }
interface Event {
  id: number; sport: string; name: string; location: string; dist: number;
  date: { d: string; m: string }; time: string; going: number; type: string;
  tags: string[]; desc: string;
  details: Record<string, string>;
  attendees: Attendee[];
}

const ALL_EVENTS: Event[] = [
  { id: 1,  sport: "running",    name: "LA Spring Half Marathon",         location: "Santa Monica, CA",   dist: 4.2,  date: { d: "13", m: "Apr" }, time: "7:00 AM",  going: 847, type: "Race",   tags: ["Medal", "Chip timed", "All levels"],        desc: "Join 800+ runners for the annual LA Spring Half Marathon along the iconic Santa Monica beachfront. Flat fast course, perfect for a PB attempt. Finisher medal and post-race brunch included.",                                                                                      details: { Distance: "13.1 mi", Start: "7:00 AM", Entry: "$45", Level: "All levels" },          attendees: [{ i: "JK", bg: "#FFF7ED", c: "#9A3412" }, { i: "SL", bg: "#FEF9C3", c: "#854D0E" }, { i: "MC", bg: "#E0F2FE", c: "#0369A1" }, { i: "YT", bg: "#FCE7F3", c: "#9D174D" }] },
  { id: 2,  sport: "cycling",    name: "Pacific Coast Century Ride",      location: "Malibu, CA",         dist: 8.1,  date: { d: "19", m: "Apr" }, time: "6:30 AM",  going: 203, type: "Social", tags: ["100 mi", "Scenic", "SAG support"],           desc: "A stunning 100-mile ride along PCH from Malibu to Ventura and back. SAG wagons every 20 miles, rest stops with food and drinks. Suitable for experienced cyclists.",                                                                                                             details: { Distance: "100 mi", Start: "6:30 AM", Entry: "$35", Level: "Advanced" },             attendees: [{ i: "MC", bg: "#FEF9C3", c: "#854D0E" }, { i: "OB", bg: "#F0FDF4", c: "#166534" }] },
  { id: 3,  sport: "climbing",   name: "SoCal Bouldering Open",           location: "Claremont, CA",      dist: 12.4, date: { d: "27", m: "Apr" }, time: "9:00 AM",  going: 88,  type: "Race",   tags: ["V4–V10", "Cash prizes", "Community"],       desc: "Indoor bouldering competition open to all levels, with categories from V4 to V10+. Cash prizes for top 3 in each category. Qualifiers + finals format, spectators welcome.",                                                                                                   details: { Distance: "N/A", Start: "9:00 AM", Entry: "$30", Level: "Intermediate–Elite" },      attendees: [{ i: "AM", bg: "#ECFDF5", c: "#065F46" }, { i: "SR", bg: "#F5F3FF", c: "#6D28D9" }] },
  { id: 4,  sport: "swimming",   name: "Open Water 5K — Marina del Rey", location: "Marina del Rey, CA", dist: 6.8,  date: { d: "3",  m: "May" }, time: "7:30 AM",  going: 154, type: "Race",   tags: ["Ocean swim", "Wetsuit OK", "Chip timed"],   desc: "Annual open water 5K in the protected waters of Marina del Rey. Calm conditions, buoyed course, safety kayakers throughout. Wetsuits permitted but not required.",                                                                                                               details: { Distance: "5K", Start: "7:30 AM", Entry: "$40", Level: "All levels" },               attendees: [{ i: "YT", bg: "#FCE7F3", c: "#9D174D" }, { i: "JK", bg: "#FFF7ED", c: "#9A3412" }] },
  { id: 5,  sport: "running",    name: "Griffith Park 10K Trailblazer",   location: "Los Feliz, CA",      dist: 9.3,  date: { d: "10", m: "May" }, time: "7:00 AM",  going: 312, type: "Race",   tags: ["Trail", "Elevation", "Dog-friendly"],       desc: "A scenic 10K trail race through Griffith Park with 800ft of elevation gain. Stunning views of the city and Hollywood sign. Dog-friendly with leash.",                                                                                                                           details: { Distance: "10K", Start: "7:00 AM", Entry: "$28", Level: "Intermediate" },            attendees: [{ i: "SL", bg: "#FEF9C3", c: "#854D0E" }, { i: "JK", bg: "#FFF7ED", c: "#9A3412" }] },
  { id: 6,  sport: "yoga",       name: "Sunrise Yoga in the Park",        location: "Echo Park, CA",      dist: 5.1,  date: { d: "17", m: "May" }, time: "6:00 AM",  going: 67,  type: "Social", tags: ["All levels", "Free", "Outdoor"],            desc: "Weekly sunrise yoga session in Echo Park led by certified instructors. Bring your own mat. Free for all levels — beginners very welcome. Followed by optional coffee meetup.",                                                                                                  details: { Distance: "N/A", Start: "6:00 AM", Entry: "Free", Level: "All levels" },             attendees: [{ i: "AM", bg: "#ECFDF5", c: "#065F46" }] },
  { id: 7,  sport: "basketball", name: "3x3 Venice Beach Tournament",     location: "Venice Beach, CA",   dist: 7.2,  date: { d: "24", m: "May" }, time: "10:00 AM", going: 196, type: "Race",   tags: ["3v3", "Cash prize", "Outdoor"],             desc: "The annual Venice Beach 3x3 basketball tournament on the world-famous outdoor courts. Register as a team of 3–4. Cash prizes for winners. Spectators welcome on the boardwalk.",                                                                                               details: { Distance: "N/A", Start: "10:00 AM", Entry: "$20/team", Level: "All levels" },        attendees: [{ i: "OB", bg: "#F0FDF4", c: "#166534" }, { i: "JK", bg: "#FFF7ED", c: "#9A3412" }] },
  { id: 8,  sport: "cycling",    name: "Pasadena Gran Fondo",              location: "Pasadena, CA",       dist: 14.7, date: { d: "31", m: "May" }, time: "6:00 AM",  going: 421, type: "Race",   tags: ["Timed", "Scenic", "Multiple distances"],    desc: "Choose your distance: 40, 75, or 100 miles through the San Gabriel foothills. Fully supported with SAG, mechanical support, and post-ride festival. One of Southern California's premier sportives.", details: { Distance: "40/75/100 mi", Start: "6:00 AM", Entry: "$55", Level: "Intermediate–Pro" }, attendees: [{ i: "MC", bg: "#FEF9C3", c: "#854D0E" }] },
  { id: 9,  sport: "tennis",     name: "Westside Open Tennis Tournament", location: "Brentwood, CA",      dist: 3.8,  date: { d: "7",  m: "Jun" }, time: "8:00 AM",  going: 44,  type: "Race",   tags: ["NTRP rated", "Singles + Doubles", "All ages"], desc: "NTRP-rated singles and doubles tournament across 3.0 to 5.0 levels. Matches played on hard courts at Brentwood Recreation Center. Prize balls and trophies for winners.",                                                                                                         details: { Distance: "N/A", Start: "8:00 AM", Entry: "$35", Level: "All levels" },              attendees: [{ i: "SL", bg: "#FEF9C3", c: "#854D0E" }] },
  { id: 10, sport: "football",   name: "LAFC Community 5-a-side League",  location: "Hollywood, CA",      dist: 11.0, date: { d: "1",  m: "Jun" }, time: "11:00 AM", going: 88,  type: "Social", tags: ["Weekly", "5v5", "All welcome"],             desc: "Weekly recreational 5-a-side football league running through summer. Register as a team or as an individual to be placed. Turf pitches, refs provided, no slide tackling.",                                                                                                     details: { Distance: "N/A", Start: "11:00 AM", Entry: "$15/session", Level: "Beginner–Intermediate" }, attendees: [{ i: "OB", bg: "#F0FDF4", c: "#166534" }, { i: "MC", bg: "#FEF9C3", c: "#854D0E" }] },
  { id: 11, sport: "running",    name: "Sunset Strip Night Run 8K",       location: "West Hollywood, CA", dist: 2.9,  date: { d: "14", m: "Jun" }, time: "9:00 PM",  going: 502, type: "Race",   tags: ["Night race", "LED lit", "Party finish"],    desc: "Run 8K through the famous Sunset Strip after dark. LED accessories encouraged. DJ at the finish line, after-party at a rooftop venue. One of LA's most fun evening events.",                                                                                                   details: { Distance: "8K", Start: "9:00 PM", Entry: "$38", Level: "All levels" },               attendees: [{ i: "JK", bg: "#FFF7ED", c: "#9A3412" }, { i: "SL", bg: "#FEF9C3", c: "#854D0E" }, { i: "YT", bg: "#FCE7F3", c: "#9D174D" }] },
  { id: 12, sport: "swimming",   name: "Santa Monica Pool Masters",       location: "Santa Monica, CA",   dist: 4.5,  date: { d: "21", m: "Jun" }, time: "8:00 AM",  going: 78,  type: "Race",   tags: ["Pool swim", "Masters", "USMS sanctioned"], desc: "USMS-sanctioned masters swim meet at the Santa Monica Swim Center. All ages 18+, multiple distance events from 50m to 1500m. Register for individual events or full program.",                                                                                                   details: { Distance: "50m–1500m", Start: "8:00 AM", Entry: "$30", Level: "Intermediate–Elite" }, attendees: [{ i: "YT", bg: "#FCE7F3", c: "#9D174D" }] },
];

const ZIP_DATA = [
  { zip: "90210", city: "Beverly Hills, CA" }, { zip: "90291", city: "Venice, CA" },
  { zip: "90401", city: "Santa Monica, CA" }, { zip: "90028", city: "Hollywood, CA" },
  { zip: "10001", city: "New York, NY" }, { zip: "10002", city: "Lower East Side, NY" },
  { zip: "60601", city: "Chicago, IL" }, { zip: "77001", city: "Houston, TX" },
  { zip: "85001", city: "Phoenix, AZ" }, { zip: "19101", city: "Philadelphia, PA" },
  { zip: "78201", city: "San Antonio, TX" }, { zip: "92101", city: "San Diego, CA" },
  { zip: "75201", city: "Dallas, TX" }, { zip: "95101", city: "San Jose, CA" },
];

const SPORTS_SIDEBAR = [
  { key: "all",        label: "All sports",   dot: "#6B7280", count: 2140 },
  { key: "running",    label: "Running",      dot: "#F97316", count: 612 },
  { key: "cycling",    label: "Cycling",      dot: "#3B82F6", count: 488 },
  { key: "swimming",   label: "Swimming",     dot: "#14B8A6", count: 201 },
  { key: "climbing",   label: "Climbing",     dot: "#8B5CF6", count: 134 },
  { key: "football",   label: "Football",     dot: "#10B981", count: 298 },
  { key: "basketball", label: "Basketball",   dot: "#EF4444", count: 187 },
  { key: "tennis",     label: "Tennis",       dot: "#F59E0B", count: 110 },
  { key: "yoga",       label: "Yoga",         dot: "#EC4899", count: 110 },
];

const EVENT_TYPES = [
  { label: "All types",          dot: "#6B7280", count: 2140 },
  { label: "Race / Competition", dot: "#EF4444", count: 840 },
  { label: "Group training",     dot: "#3B82F6", count: 612 },
  { label: "Social ride / run",  dot: "#10B981", count: 398 },
  { label: "Workshop / Clinic",  dot: "#F59E0B", count: 290 },
];

const SPORT_FILTER_PILLS = [
  { key: "all",        label: "All sports" },
  { key: "running",    label: "🏃 Running" },
  { key: "cycling",    label: "🚴 Cycling" },
  { key: "swimming",   label: "🏊 Swimming" },
  { key: "climbing",   label: "🧗 Climbing" },
  { key: "football",   label: "⚽ Football" },
  { key: "basketball", label: "🏀 Basketball" },
  { key: "tennis",     label: "🎾 Tennis" },
  { key: "yoga",       label: "🧘 Yoga" },
];

export default function Events() {
  const [, setLocation] = useLocation();
  const [sport, setSport] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dateFilter, setDateFilter] = useState("any");
  const [radius, setRadius] = useState(25);
  const [zipInput, setZipInput] = useState("90210");
  const [locationCity, setLocationCity] = useState("Beverly Hills, CA");
  const [showDropdown, setShowDropdown] = useState(false);
  const [sort, setSort] = useState("date");
  const [joined, setJoined] = useState<Set<number>>(new Set());
  const [modalEvent, setModalEvent] = useState<Event | null>(null);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [eventTypeActive, setEventTypeActive] = useState(0);
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zipMatches = ZIP_DATA.filter(z =>
    zipInput.length >= 2 && (z.zip.startsWith(zipInput) || z.city.toLowerCase().includes(zipInput.toLowerCase()))
  ).slice(0, 5);

  function showToast(msg: string) {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  }

  function getFiltered(): Event[] {
    let data = [...ALL_EVENTS];
    if (sport !== "all") data = data.filter(e => e.sport === sport);
    if (radius !== 9999) data = data.filter(e => e.dist <= radius);
    if (sort === "distance") data.sort((a, b) => a.dist - b.dist);
    else if (sort === "popular") data.sort((a, b) => b.going - a.going);
    return data;
  }

  function toggleJoin(id: number) {
    setJoined(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); showToast("Removed from your events"); }
      else { next.add(id); showToast("🎉 You're going! Added to your calendar"); }
      return next;
    });
  }

  function joinFromModal(id: number) {
    setJoined(prev => { const next = new Set(prev); next.add(id); return next; });
    setModalEvent(prev => prev ? { ...prev } : null);
    showToast("🎉 You're going! Added to your calendar");
  }

  function selectLocation(zip: string, city: string) {
    setZipInput(zip);
    setLocationCity(city);
    setShowDropdown(false);
    showToast("📍 Showing events near " + city);
  }

  const filtered = getFiltered();
  const featuredEvent = ALL_EVENTS[0];

  return (
    <div>
      <Topbar loggedIn={false} activeNav="Events" />

      {/* Page Header */}
      <div className="ev-page-header">
        <div className="ev-page-header-inner">
          <h1>Events near you 📅</h1>
          <p>Races, meetups, competitions and group sessions across every sport — filtered to your area.</p>
          <div className="ev-header-meta">
            <div className="ev-header-stat">
              <div className="ev-header-stat-dot" style={{ background: "#10B981" }} />
              <strong>2,140</strong> upcoming events
            </div>
            <div className="ev-header-stat">
              <div className="ev-header-stat-dot" style={{ background: "#3B82F6" }} />
              <strong>47</strong> sports
            </div>
            <div className="ev-header-stat">
              <div className="ev-header-stat-dot" style={{ background: "#F97316" }} />
              Showing events within <strong>{radius === 9999 ? "anywhere" : `${radius} miles`}</strong> of <strong>{zipInput}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="ev-filter-bar">
        <div className="ev-filter-bar-inner">
          <div className="ev-search-group">
            <div className="ev-location-wrap">
              <span className="ev-loc-icon">📍</span>
              <input
                className="ev-location-input"
                type="text"
                placeholder="Enter zip code or city…"
                value={zipInput}
                data-testid="input-location"
                onChange={e => setZipInput(e.target.value)}
                onFocus={() => { if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current); setShowDropdown(true); }}
                onBlur={() => { dropdownTimerRef.current = setTimeout(() => setShowDropdown(false), 200); }}
              />
              {showDropdown && zipMatches.length > 0 && (
                <div className="ev-loc-dropdown">
                  {zipMatches.map(m => (
                    <div key={m.zip} className="ev-loc-suggestion" onMouseDown={() => selectLocation(m.zip, m.city)}>
                      📍 <span className="ev-zip">{m.zip}</span> <span className="ev-city">{m.city}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <select
              className="ev-radius-select"
              value={radius}
              data-testid="select-radius"
              onChange={e => setRadius(Number(e.target.value))}
            >
              <option value={5}>Within 5 mi</option>
              <option value={10}>Within 10 mi</option>
              <option value={25}>Within 25 mi</option>
              <option value={50}>Within 50 mi</option>
              <option value={100}>Within 100 mi</option>
              <option value={9999}>Anywhere</option>
            </select>
          </div>

          <div className="ev-filter-divider" />

          <div className="ev-filter-pills">
            {SPORT_FILTER_PILLS.map(p => (
              <button
                key={p.key}
                className={`ev-filter-pill${sport === p.key ? " active" : ""}`}
                onClick={() => setSport(p.key)}
                data-testid={`pill-sport-${p.key}`}
              >{p.label}</button>
            ))}
          </div>

          <div className="ev-view-toggle">
            <button className={`ev-view-btn${view === "grid" ? " active" : ""}`} onClick={() => setView("grid")} title="Grid view" data-testid="btn-view-grid">⊞</button>
            <button className={`ev-view-btn${view === "list" ? " active" : ""}`} onClick={() => setView("list")} title="List view" data-testid="btn-view-list">≡</button>
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="ev-main">

        {/* Sidebar */}
        <aside className="ev-sidebar">

          {/* Date */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">Date</div>
            <div className="ev-date-options">
              {[
                { val: "any",     label: "Any date" },
                { val: "week",    label: "This week" },
                { val: "month",   label: "This month" },
                { val: "3months", label: "Next 3 months" },
                { val: "weekend", label: "Weekends only" },
              ].map(opt => (
                <label key={opt.val} className={`ev-date-option${dateFilter === opt.val ? " active" : ""}`} onClick={() => setDateFilter(opt.val)}>
                  <input type="radio" name="date" readOnly checked={dateFilter === opt.val} /> {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Distance slider */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">Distance from you</div>
            <div className="ev-distance-slider-wrap">
              <div className="ev-distance-label">
                <span>0 mi</span>
                <strong>{radius >= 9999 ? "100+ mi" : `${radius} mi`}</strong>
              </div>
              <input
                type="range" min={1} max={100}
                value={Math.min(radius, 100)}
                data-testid="slider-radius"
                onChange={e => setRadius(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--gray-900)", cursor: "pointer" }}
              />
            </div>
          </div>

          {/* Sport */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">Sport</div>
            <div className="ev-sidebar-section">
              {SPORTS_SIDEBAR.map(s => (
                <div
                  key={s.key}
                  className={`ev-sidebar-item${sport === s.key ? " active" : ""}`}
                  onClick={() => setSport(s.key)}
                  data-testid={`sidebar-sport-${s.key}`}
                >
                  <div className="ev-sidebar-item-left">
                    <div className="ev-sport-dot" style={{ background: s.dot }} />
                    {s.label}
                  </div>
                  <span className="ev-sidebar-count">{s.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Event type */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">Event type</div>
            <div className="ev-sidebar-section">
              {EVENT_TYPES.map((t, i) => (
                <div
                  key={t.label}
                  className={`ev-sidebar-item${eventTypeActive === i ? " active" : ""}`}
                  onClick={() => setEventTypeActive(i)}
                >
                  <div className="ev-sidebar-item-left">
                    <div className="ev-sport-dot" style={{ background: t.dot }} />
                    {t.label}
                  </div>
                  <span className="ev-sidebar-count">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          {/* My sports */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">My sports</div>
            <div className="ev-sidebar-section">
              <div className="ev-sidebar-item" style={{ background: "var(--yellow-light)", color: "#7a5c00", fontWeight: 500 }} onClick={() => setSport("running")}>
                <div className="ev-sidebar-item-left">
                  <div className="ev-sport-dot" style={{ background: "#F97316" }} />
                  Running
                </div>
                <span className="ev-sidebar-count" style={{ color: "#7a5c00" }}>612</span>
              </div>
              <div className="ev-sidebar-item" onClick={() => setSport("cycling")}>
                <div className="ev-sidebar-item-left">
                  <div className="ev-sport-dot" style={{ background: "#3B82F6" }} />
                  Cycling
                </div>
                <span className="ev-sidebar-count">488</span>
              </div>
              <div style={{ padding: "8px 8px 4px" }}>
                <button className="btn btn-ghost" style={{ fontSize: "12px", width: "100%", justifyContent: "center", padding: "5px" }}>+ Add sport</button>
              </div>
            </div>
          </div>

          {/* Coming up soon */}
          <div className="sidebar-card">
            <div className="ev-sidebar-title">Coming up soon</div>
            <div>
              {ALL_EVENTS.slice(0, 5).map(ev => {
                const sc = sportColors[ev.sport] || sportColors.running;
                return (
                  <div key={ev.id} className="ev-mini-event" onClick={() => setModalEvent(ev)}>
                    <div className="ev-mini-date-box">
                      <div className="ev-mini-d">{ev.date.d}</div>
                      <div className="ev-mini-m">{ev.date.m}</div>
                    </div>
                    <div className="ev-mini-info">
                      <div className="ev-mini-name">{ev.name}</div>
                      <div className="ev-mini-sport">{sc.tag} {ev.dist} mi away</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </aside>

        {/* Content */}
        <div className="ev-content">

          {/* Results header */}
          <div className="ev-results-header">
            <div className="ev-results-count">
              Showing <strong>{filtered.length}</strong> events near <strong>{locationCity}</strong>
            </div>
            <div className="ev-sort-wrap">
              Sort by
              <select className="ev-sort-select" value={sort} onChange={e => setSort(e.target.value)} data-testid="select-sort">
                <option value="date">Date</option>
                <option value="distance">Distance</option>
                <option value="popular">Most popular</option>
              </select>
            </div>
          </div>

          {/* Featured event */}
          <div className="ev-featured" onClick={() => setModalEvent(featuredEvent)} data-testid="featured-event">
            <div className="ev-featured-badge">⭐ Featured</div>
            <div className="ev-featured-date-box">
              <div className="ev-fd">{featuredEvent.date.d}</div>
              <div className="ev-fm">{featuredEvent.date.m}</div>
            </div>
            <div className="ev-featured-info">
              <div className="ev-featured-sport-tag">🏃 Running</div>
              <div className="ev-featured-name">{featuredEvent.name}</div>
              <div className="ev-featured-meta">
                <div className="ev-featured-meta-item">📍 Santa Monica, CA · 4.2 mi away</div>
                <div className="ev-featured-meta-item">⏱ 7:00 AM start</div>
                <div className="ev-featured-meta-item">🏅 Medal finisher event</div>
              </div>
            </div>
            <div className="ev-featured-actions">
              <div className="ev-att-avatars">
                {[{ i: "JK", bg: "#FFF7ED", c: "#9A3412" }, { i: "MC", bg: "#E0F2FE", c: "#0369A1" }, { i: "SL", bg: "#FEF9C3", c: "#854D0E" }].map(a => (
                  <div key={a.i} className="ev-att-av" style={{ background: a.bg, color: a.c }}>{a.i}</div>
                ))}
                <div className="ev-att-av" style={{ background: "#6B7280", color: "white", fontSize: 8 }}>+42</div>
              </div>
              <div className="ev-featured-going">847 athletes going</div>
              <button
                className={`btn btn-yellow${joined.has(featuredEvent.id) ? " ev-joined" : ""}`}
                onClick={e => { e.stopPropagation(); toggleJoin(featuredEvent.id); }}
                data-testid="btn-join-featured"
              >
                {joined.has(featuredEvent.id) ? "✓ Going" : "+ Join event"}
              </button>
            </div>
          </div>

          {/* Events grid / list */}
          {filtered.length === 0 ? (
            <div className="ev-empty-state">
              <div className="ev-empty-icon">🔍</div>
              <h3>No events found</h3>
              <p>Try expanding your search radius or changing the sport filter.</p>
              <button className="btn btn-primary" onClick={() => { setSport("all"); setRadius(25); }} data-testid="btn-clear-filters">Clear all filters</button>
            </div>
          ) : (
            <div className={`ev-events-grid${view === "list" ? " ev-list-view" : ""}`}>
              {filtered.map(ev => {
                const sc = sportColors[ev.sport] || sportColors.running;
                const isJoined = joined.has(ev.id);
                return (
                  <div key={ev.id} className="ev-card" onClick={() => setModalEvent(ev)} data-testid={`event-card-${ev.id}`}>
                    <div className="ev-card-header">
                      <div className="ev-ec-date-box" style={{ background: sc.bg }}>
                        <div className="ev-ec-d" style={{ color: sc.color }}>{ev.date.d}</div>
                        <div className="ev-ec-m" style={{ color: sc.color }}>{ev.date.m}</div>
                      </div>
                      <div className="ev-ec-info">
                        <div className="ev-ec-sport-row">
                          <span className="ev-ec-sport-tag" style={{ background: sc.bg, color: sc.color }}>{sc.tag} {ev.sport.charAt(0).toUpperCase() + ev.sport.slice(1)}</span>
                          <span className="ev-ec-dist">📍 {ev.dist} mi away</span>
                        </div>
                        <div className="ev-ec-name">{ev.name}</div>
                        <div className="ev-ec-location">📌 {ev.location}</div>
                      </div>
                    </div>
                    <div className="ev-card-body">
                      <div className="ev-ec-desc">{ev.desc}</div>
                      <div className="ev-ec-tags">
                        {ev.tags.map(t => <span key={t} className="ev-ec-tag">{t}</span>)}
                        <span className="ev-ec-tag">{ev.type}</span>
                      </div>
                    </div>
                    <div className="ev-card-footer">
                      <div className="ev-ec-going">
                        <div className="ev-ec-going-avatars">
                          {ev.attendees.slice(0, 3).map(a => (
                            <div key={a.i} className="ev-ec-going-av" style={{ background: a.bg, color: a.c }}>{a.i}</div>
                          ))}
                        </div>
                        <span className="ev-ec-going-count">{ev.going} going</span>
                      </div>
                      <button
                        className={`ev-join-btn${isJoined ? " joined" : ""}`}
                        onClick={e => { e.stopPropagation(); toggleJoin(ev.id); }}
                        data-testid={`btn-join-${ev.id}`}
                      >
                        {isJoined ? "✓ Going" : "+ Join"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ev-load-more">
            <button className="ev-load-more-btn" onClick={() => showToast("All events loaded for your area")} data-testid="btn-load-more">
              Load more events
            </button>
          </div>
        </div>
      </main>

      {/* Event Detail Modal */}
      {modalEvent && (
        <div className="ev-modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalEvent(null); }}>
          <div className="ev-modal" onClick={e => e.stopPropagation()}>
            <div className="ev-modal-header">
              <div>
                {(() => {
                  const sc = sportColors[modalEvent.sport] || sportColors.running;
                  return (
                    <>
                      <span className="ev-modal-sport-tag" style={{ background: sc.bg, color: sc.color }}>
                        {sc.tag} {modalEvent.sport.charAt(0).toUpperCase() + modalEvent.sport.slice(1)}
                      </span>
                      <div className="ev-modal-name">{modalEvent.name}</div>
                      <div className="ev-modal-location">📌 {modalEvent.location} · {modalEvent.dist} mi from you</div>
                    </>
                  );
                })()}
              </div>
              <button className="ev-modal-close" onClick={() => setModalEvent(null)} data-testid="btn-modal-close">✕</button>
            </div>
            <div className="ev-modal-body">
              <div className="ev-modal-map">
                <div className="ev-modal-map-bg" />
                <div className="ev-modal-map-pin">{(sportColors[modalEvent.sport] || sportColors.running).tag}</div>
              </div>
              <div>
                <div className="ev-modal-section-title">Event details</div>
                <div className="ev-modal-detail-grid">
                  {Object.entries(modalEvent.details).map(([k, v]) => (
                    <div key={k} className="ev-modal-detail-item">
                      <div className="ev-modal-detail-lbl">{k}</div>
                      <div className="ev-modal-detail-val">{v}</div>
                    </div>
                  ))}
                  <div className="ev-modal-detail-item">
                    <div className="ev-modal-detail-lbl">Date</div>
                    <div className="ev-modal-detail-val">{modalEvent.date.d} {modalEvent.date.m}</div>
                  </div>
                  <div className="ev-modal-detail-item">
                    <div className="ev-modal-detail-lbl">Going</div>
                    <div className="ev-modal-detail-val">{modalEvent.going}</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="ev-modal-section-title">Description</div>
                <p className="ev-modal-desc">{modalEvent.desc}</p>
              </div>
              <div>
                <div className="ev-modal-section-title">Athletes attending</div>
                <div className="ev-modal-attendees">
                  {modalEvent.attendees.map(a => (
                    <div key={a.i} className="ev-modal-att">
                      <div className="ev-modal-att-av" style={{ background: a.bg, color: a.c }}>{a.i}</div>
                      <div className="ev-modal-att-name">{a.i}</div>
                    </div>
                  ))}
                  <div className="ev-modal-att" style={{ background: "var(--gray-50)" }}>
                    <div style={{ fontSize: 12, color: "var(--gray-500)", padding: "0 4px" }}>+{modalEvent.going - modalEvent.attendees.length} more</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="ev-modal-footer">
              <button
                className={`btn${joined.has(modalEvent.id) ? " btn-ghost" : " btn-yellow"}`}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => { if (!joined.has(modalEvent.id)) joinFromModal(modalEvent.id); }}
                data-testid="btn-modal-join"
              >
                {joined.has(modalEvent.id) ? "✓ Already going" : "+ Join this event"}
              </button>
              <button className="btn btn-ghost" onClick={() => setModalEvent(null)} data-testid="btn-modal-close-2">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`ev-toast${toastVisible ? " show" : ""}`}>{toast}</div>

      <Footer />
    </div>
  );
}
