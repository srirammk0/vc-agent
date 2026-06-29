type Status = "new" | "approved" | "passed";

const STYLES: Record<Status, React.CSSProperties> = {
  new: {
    background: "#EAF3FF",
    color: "#007AFF",
    border: "1px solid rgba(0,122,255,0.25)",
  },
  approved: {
    background: "#ECFFE7",
    color: "#0F7A3D",
    border: "1px solid rgba(134,252,111,0.6)",
  },
  passed: {
    background: "#F4F4F4",
    color: "#999999",
    border: "1px solid #E2E2E2",
    textDecoration: "line-through",
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
