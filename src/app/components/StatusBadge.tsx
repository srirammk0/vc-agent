import { Pill } from "./ui/Pill";
import type { DealflowStatus } from "../../lib/supabase";

const BADGE: Record<DealflowStatus, React.CSSProperties> = {
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
  responded: {
    background: "rgba(46,155,143,0.1)",
    color: "#2e9b8f",
    border: "1px solid rgba(46,155,143,0.25)",
  },
  call_booked: {
    background: "rgba(88,86,214,0.1)",
    color: "#5856d6",
    border: "1px solid rgba(88,86,214,0.25)",
  },
  passed: {
    background: "rgba(255,59,48,0.08)",
    color: "var(--danger-text)",
    border: "1px solid rgba(255,59,48,0.18)",
  },
};

const LABEL: Record<DealflowStatus, string> = {
  new: "new",
  approved: "approved",
  responded: "responded",
  call_booked: "call booked",
  passed: "passed",
};

export default function StatusBadge({ status }: { status: DealflowStatus }) {
  return <Pill style={BADGE[status]}>{LABEL[status]}</Pill>;
}
