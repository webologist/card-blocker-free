export default function Home() {
  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        html { scroll-behavior: smooth; }
        body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
        :root { --red: #d63a2a; }
        [data-theme="dark"] body { background: #0f172a; color: #f1f5f9; }
      `}</style>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "4rem 1.5rem" }}>
        <div style={{ marginBottom: "3rem" }}>
          <h1 style={{
            fontSize: "3.5rem",
            fontWeight: 900,
            lineHeight: 1.04,
            marginBottom: "1rem"
          }}>
            Your wallet is stolen.
            <br />
            <span style={{ color: "#d63a2a" }}>You have 4 minutes.</span>
          </h1>

          <p style={{
            fontSize: "1.1rem",
            maxWidth: "600px",
            lineHeight: 1.7,
            marginBottom: "2rem",
            color: "#6b7280"
          }}>
            Fraudsters drain the average Indian account in under 4 minutes. Without your card numbers saved, you cannot block them fast enough. BlockMyCard keeps every card number in one place so you can act quickly.
          </p>

          <button style={{
            background: "#d63a2a",
            color: "white",
            padding: "0.85rem 1.75rem",
            border: "none",
            borderRadius: "8px",
            fontWeight: 700,
            fontSize: "1rem",
            cursor: "pointer",
            marginRight: "1rem"
          }}>
            Register Free — 60 Seconds →
          </button>

          <button style={{
            background: "transparent",
            color: "#111827",
            padding: "0.8rem 1.5rem",
            border: "2px solid #e5e7eb",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: "pointer"
          }}>
            Block your card
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "2rem" }}>
          <span style={{ padding: "0.35rem 0.85rem", background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: "99px" }}>✓ Free</span>
          <span style={{ padding: "0.35rem 0.85rem", background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: "99px" }}>✓ For Indian banks</span>
          <span style={{ padding: "0.35rem 0.85rem", background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: "99px" }}>✓ Any phone</span>
          <span style={{ padding: "0.35rem 0.85rem", background: "#f8f9fa", border: "1px solid #e5e7eb", borderRadius: "99px" }}>✓ All cards protected</span>
        </div>

        <p style={{ fontSize: "0.9rem", color: "#6b7280", marginTop: "3rem" }}>
          💡 <strong>Full website:</strong> Run <code>npm run dev</code> locally for the complete BlockMyCard.in experience with all features.
        </p>
      </div>
    </div>
  );
}
