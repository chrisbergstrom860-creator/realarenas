export default function TrendingTopics() {
  const topics = [
    { hashtag: "#SpringMarathons", sport: "Running", posts: "4,210 posts" },
    { hashtag: "#ClimbingBeta", sport: "Climbing", posts: "1,820 posts" },
    { hashtag: "#CyclingStelvio", sport: "Cycling", posts: "940 posts" },
    { hashtag: "#SwimOpen2026", sport: "Swimming", posts: "612 posts" },
    { hashtag: "#5AsideSeason", sport: "Football", posts: "408 posts" },
    { hashtag: "#GravelGang", sport: "Cycling", posts: "371 posts" },
  ];

  return (
    <div>
      <div className="section-header" style={{ marginTop: "8px" }}>
        <h2>Trending topics</h2>
        <a href="#">Explore →</a>
      </div>
      <div style={{ background: "white", border: "var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        {topics.map((t, idx) => (
          <div className="trending-item" key={idx}>
            <span className="trend-tag">{t.hashtag} <span>· {t.sport}</span></span>
            <span className="trend-count">{t.posts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
