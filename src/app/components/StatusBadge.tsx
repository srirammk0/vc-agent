type Status = "new" | "approved" | "passed";

const STYLES: Record<Status, React.CSSProperties> = {
  new: {
    background: "#EAF3FF",
    color: "#007AFF",
    border: "1px solid rgba(0,122,255,0.25)",
  },
  approved: {
    background: "#E9F8EF",
    color: "#147A45",
    border: "1px solid rgba(31,174,103,0.35)",
  },
  passed: {
    background: "#FDECEC",
    color: "#C13438",
    border: "1px solid rgba(229,72,77,0.3)",
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
