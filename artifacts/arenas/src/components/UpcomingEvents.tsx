export default function UpcomingEvents() {
  return (
    <div>
      <div className="section-header" style={{ marginTop: "8px" }}>
        <h2>Upcoming events</h2>
        <a href="#">View all →</a>
      </div>
      <div className="cards-grid wide">
        <div className="event-card">
          <div className="event-date-box">
            <div className="day">13</div>
            <div className="mon">Apr</div>
          </div>
          <div className="event-info">
            <div className="event-name">Berlin Half Marathon</div>
            <div className="event-meta">Berlin, Germany · Running</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="event-going">847 going</div>
            <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }}>+ Join</button>
          </div>
        </div>

        <div className="event-card">
          <div className="event-date-box">
            <div className="day">19</div>
            <div className="mon">Apr</div>
          </div>
          <div className="event-info">
            <div className="event-name">Open Water 5K</div>
            <div className="event-meta">Lake Geneva, CH · Swimming</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="event-going">203 going</div>
            <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }}>+ Join</button>
          </div>
        </div>

        <div className="event-card">
          <div className="event-date-box">
            <div className="day">27</div>
            <div className="mon">Apr</div>
          </div>
          <div className="event-info">
            <div className="event-name">Granfondo Stelvio</div>
            <div className="event-meta">South Tyrol, Italy · Cycling</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="event-going">1.2k going</div>
            <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }}>+ Join</button>
          </div>
        </div>

        <div className="event-card">
          <div className="event-date-box">
            <div className="day">3</div>
            <div className="mon">May</div>
          </div>
          <div className="event-info">
            <div className="event-name">Urban Bouldering League</div>
            <div className="event-meta">London, UK · Climbing</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="event-going">88 going</div>
            <button className="btn btn-ghost" style={{ fontSize: "12px", padding: "4px 10px", marginTop: "4px" }}>+ Join</button>
          </div>
        </div>
      </div>
    </div>
  );
}
