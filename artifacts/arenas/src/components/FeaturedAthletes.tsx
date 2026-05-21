export default function FeaturedAthletes() {
  return (
    <div>
      <div className="section-header">
        <h2>Featured athletes</h2>
        <a href="#">View all →</a>
      </div>
      <div className="cards-grid">
        <div className="card">
          <div className="card-top">
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div className="card-avatar" style={{ background: "#FEF9C3" }}>🏃</div>
              <div>
                <div className="card-title">Sofia L.</div>
                <div className="card-author">Prague · 2.4k followers</div>
              </div>
            </div>
          </div>
          <div className="card-desc">Marathon runner chasing sub-2:55. Logging every mile publicly. Coach at Sparta Athletic Club.</div>
          <div className="card-tags">
            <span className="tag sport">Running</span>
            <span className="tag level">Advanced</span>
            <span className="tag">Triathlon</span>
          </div>
          <div className="card-footer">
            <div className="card-footer-left">
              <div className="card-stat">🔥 312 activities</div>
              <div className="card-stat">⭐ 9,840 pts</div>
            </div>
            <div className="card-updated">Active today</div>
          </div>
        </div>

        <div className="card">
          <div className="card-top">
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div className="card-avatar" style={{ background: "#E0F2FE" }}>🚴</div>
              <div>
                <div className="card-title">Marco C.</div>
                <div className="card-author">Milan · 1.8k followers</div>
              </div>
            </div>
          </div>
          <div className="card-desc">Granfondo specialist. 40,000 km logged in 2025. Stelvio is home. Leading the Milan Cycling collective.</div>
          <div className="card-tags">
            <span className="tag sport">Cycling</span>
            <span className="tag level">Elite / Pro</span>
            <span className="tag">Gravel</span>
          </div>
          <div className="card-footer">
            <div className="card-footer-left">
              <div className="card-stat">🔥 287 activities</div>
              <div className="card-stat">⭐ 8,120 pts</div>
            </div>
            <div className="card-updated">2h ago</div>
          </div>
        </div>

        <div className="card">
          <div className="card-top">
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div className="card-avatar" style={{ background: "#ECFDF5" }}>🧗</div>
              <div>
                <div className="card-title">Alena M.</div>
                <div className="card-author">Barcelona · 980 followers</div>
              </div>
            </div>
          </div>
          <div className="card-desc">Sport climbing 7c+ and projecting 8a. Beta queen — full route breakdowns in every post.</div>
          <div className="card-tags">
            <span className="tag sport">Climbing</span>
            <span className="tag level">Advanced</span>
            <span className="tag new">New ✦</span>
          </div>
          <div className="card-footer">
            <div className="card-footer-left">
              <div className="card-stat">🔥 144 activities</div>
              <div className="card-stat">⭐ 5,220 pts</div>
            </div>
            <div className="card-updated">5h ago</div>
          </div>
        </div>
      </div>
    </div>
  );
}
