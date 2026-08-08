export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>BlockMyCard.in</h1>
      <h2>Your wallet is stolen. You have 4 minutes.</h2>
      <p>Fraudsters drain accounts in under 4 minutes. Store your card numbers here to block them fast.</p>
      <button style={{ padding: "0.75rem 1.5rem", backgroundColor: "#d63a2a", color: "white", border: "none", cursor: "pointer" }}>Register Free</button>
      <p style={{ marginTop: "2rem", fontSize: "0.9rem" }}>✓ Free · ✓ For Indian banks · ✓ Any phone · ✓ All cards protected</p>
      <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "#666" }}>Full website: <code>npm run dev</code> locally</p>
    </main>
  );
}
