type Status = "new" | "approved" | "passed";

const BADGE: Record<Status, React.CSSProperties> = {
  new: {
    background: "rgba(0,122,255,0.08)",
    color: "#007aff",
    border: "1px solid rgba(0,122,255,0.18)",
  },
  approved: {
    background: "rgba(52,199,89,0.1)",
    color: "#1a8a2e",
    border: "1px solid rgba(52,199,89,0.25)",
  },
  passed: {
    background: "rgba(255,59,48,0.08)",
    color: "#d92e23",
    border: "1px solid rgba(255,59,48,0.18)",
  },
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      style={{
        ...BADGE[status],
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 999,
        padding: "2px 9px",
        fontSize: 11.5,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        fontWeight: 500,
        letterSpacing: "0.01em",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: "currentColor",
          flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}
