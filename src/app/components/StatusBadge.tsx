type Status = "new" | "approved" | "passed";

const STYLES: Record<Status, React.CSSProperties> = {
  new: {
    background: "#dbeafe",
    color: "#0066ff",
    border: "1px solid rgba(0,102,255,0.2)",
  },
  approved: {
    background: "#dcfce7",
    color: "#15803d",
    border: "1px solid rgba(22,163,74,0.25)",
  },
  passed: {
    background: "#fee2e2",
    color: "#dc2626",
    border: "1px solid rgba(239,68,68,0.25)",
  },
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      style={{
        ...STYLES[status],
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 12,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "currentColor",
          opacity: 0.7,
        }}
      />
      {status}
    </span>
  );
}
