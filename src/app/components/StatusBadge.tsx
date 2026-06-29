type Props = { status: "new" | "approved" | "passed" };

const STYLES: Record<Props["status"], React.CSSProperties> = {
  new: {
    background: "#F0F0F0",
    color: "#616061",
    border: "1px solid #D1D1D1",
  },
  approved: {
    background: "#EBFFE6",
    color: "#007A5A",
    border: "1px solid #86FC6F",
  },
  passed: {
    background: "#F7F7F7",
    color: "#999999",
    border: "1px solid #E8E8E8",
    textDecoration: "line-through",
  },
};

export default function StatusBadge({ status }: Props) {
  return (
    <span
      style={{
        ...STYLES[status],
        display: "inline-block",
        borderRadius: 16,
        padding: "4px 12px",
        fontSize: 12,
        lineHeight: "18px",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}
