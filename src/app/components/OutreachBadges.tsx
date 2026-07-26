import { Pill } from "./ui/Pill";

type ChannelStatus = "not_contacted" | "contacted" | "replied";

const CHANNEL_STYLE: Record<ChannelStatus, React.CSSProperties> = {
  not_contacted: {
    background: "rgba(0,0,0,0.04)",
    color: "var(--muted)",
    border: "1px solid var(--border)",
  },
  contacted: {
    background: "rgba(0,122,255,0.08)",
    color: "var(--accent)",
    border: "1px solid rgba(0,122,255,0.18)",
  },
  replied: {
    background: "rgba(52,199,89,0.1)",
    color: "var(--success-text)",
    border: "1px solid rgba(52,199,89,0.25)",
  },
};

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  not_contacted: "not contacted",
  contacted: "contacted",
  replied: "replied",
};

function ChannelPill({ channel, status }: { channel: string; status: ChannelStatus }) {
  return (
    <Pill style={CHANNEL_STYLE[status]}>
      {channel}: {CHANNEL_LABEL[status]}
    </Pill>
  );
}

function relativeDays(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function OutreachBadges({
  stealth,
  linkedinStatus,
  emailStatus,
  followupCount = 0,
  lastFollowupAt = null,
}: {
  stealth: boolean;
  linkedinStatus: ChannelStatus;
  emailStatus: ChannelStatus;
  followupCount?: number;
  lastFollowupAt?: string | null;
}) {
  const since = relativeDays(lastFollowupAt);
  return (
    <>
      {stealth && (
        <Pill
          style={{
            background: "rgba(142,68,173,0.08)",
            color: "#8e44ad",
            border: "1px solid rgba(142,68,173,0.2)",
          }}
        >
          stealth
        </Pill>
      )}
      <ChannelPill channel="li" status={linkedinStatus} />
      <ChannelPill channel="email" status={emailStatus} />
      {/* Only rendered once there's actually been a follow-up — a "0 follow-ups" pill
          on every untouched row is noise, and the absence reads the same way. */}
      {followupCount > 0 && (
        <Pill
          style={{
            background: "rgba(255,149,0,0.09)",
            color: "#b26a00",
            border: "1px solid rgba(255,149,0,0.22)",
          }}
          title={lastFollowupAt ? `Last follow-up ${new Date(lastFollowupAt).toLocaleString()}` : undefined}
        >
          {followupCount === 1 ? "1 follow-up" : `${followupCount} follow-ups`}
          {since ? ` · ${since}` : ""}
        </Pill>
      )}
    </>
  );
}
