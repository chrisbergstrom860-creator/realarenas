const allEvents = [
  { day: "13", mon: "Apr", name: "Berlin Half Marathon", meta: "Berlin, Germany · Running", going: "847" },
  { day: "19", mon: "Apr", name: "Open Water 5K", meta: "Lake Geneva, CH · Swimming", going: "203" },
  { day: "27", mon: "Apr", name: "Granfondo Stelvio", meta: "South Tyrol, Italy · Cycling", going: "1.2k" },
  { day: "3", mon: "May", name: "Urban Bouldering League", meta: "London, UK · Climbing", going: "88" },
  { day: "10", mon: "May", name: "Prague 10K Spring Race", meta: "Prague, CZ · Running", going: "1.4k" },
  { day: "18", mon: "May", name: "Barcelona Triathlon", meta: "Barcelona, Spain · Triathlon", going: "620" },
  { day: "24", mon: "May", name: "Amsterdam Cycling Gran Fondo", meta: "Amsterdam, NL · Cycling", going: "930" },
  { day: "1", mon: "Jun", name: "Swiss Alpine Hiking Challenge", meta: "Interlaken, CH · Hiking", going: "310" },
];

interface UpcomingEventsProps {
  expanded?: boolean;
}

export default function UpcomingEvents({ expanded = false }: UpcomingEventsProps) {
  const events = expanded ? allEvents : allEvents.slice(0, 4);
  return (
    <div>
      <div className="section-header" style={{ marginTop: "8px" }}>
        <h2>Upcoming events</h2>
        <a href="#">View all →</a>
      </div>
      <div className="cards-grid wide">
        {events.map((e) => (
          <div className="event-card" key={e.name} data-testid={`card-event-${e.name.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="event-date-box">
              <div className="day">{e.day}</div>
              <div className="mon">{e.mon}</div>
            </div>
            <div className="event-info">
              <div className="event-name">{e.name}</div>
              <div className="event-meta">{e.meta}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="event-going">{e.going} going</div>
              <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }} data-testid={`btn-join-event-${e.name.replace(/\s+/g, "-").toLowerCase()}`}>+ Join</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
