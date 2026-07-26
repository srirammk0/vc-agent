import { Pill } from "./ui/Pill";

type Status = "new" | "approved" | "passed";

const BADGE: Record<Status, React.CSSProperties> = {
  new: {
    background: "rgba(0,122,255,0.08)",
    color: "var(--accent)",
    border: "1px solid rgba(0,122,255,0.18)",
  },
  approved: {
    background: "rgba(52,199,89,0.1)",
    color: "var(--success-text)",
    border: "1px solid rgba(52,199,89,0.25)",
  },
  passed: {
    background: "rgba(255,59,48,0.08)",
    color: "var(--danger-text)",
    border: "1px solid rgba(255,59,48,0.18)",
  },
};

export default function StatusBadge({ status }: { status: Status }) {
  return <Pill style={BADGE[status]}>{status}</Pill>;
}
