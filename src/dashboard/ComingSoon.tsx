import "./ComingSoon.css";

// Every sidebar/nav destination that doesn't have real data or backend
// support behind it yet lands here instead of pretending to work — per
// the explicit instruction this dashboard was built under: dummy features
// should read as "not yet implemented," not as broken or silently faked.
export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="cs-page">
      <div className="cs-badge">Coming soon</div>
      <h1>{title}</h1>
      <p>This section isn't built yet — it's here to show the full layout, not because it's functional.</p>
    </div>
  );
}
