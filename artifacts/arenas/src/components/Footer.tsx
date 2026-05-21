export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "22px", height: "22px", background: "var(--yellow)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>🏟</div>
          <span>Arenas © 2026</span>
        </div>
        <div className="footer-links">
          <a href="#">About</a>
          <a href="#">Blog</a>
          <a href="#">API</a>
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
        </div>
      </div>
    </footer>
  );
}
