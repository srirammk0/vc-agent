type ChannelStatus = "not_contacted" | "contacted" | "replied";

const CHANNEL_STYLE: Record<ChannelStatus, React.CSSProperties> = {
  not_contacted: {
    background: "rgba(0,0,0,0.04)",
    color: "var(--muted)",
    border: "1px solid var(--border)",
  },
  contacted: {
    background: "rgba(0,122,255,0.08)",
    color: "#007aff",
    border: "1px solid rgba(0,122,255,0.18)",
  },
  replied: {
    background: "rgba(52,199,89,0.1)",
    color: "#1a8a2e",
    border: "1px solid rgba(52,199,89,0.25)",
  },
};

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  not_contacted: "not contacted",
  contacted: "contacted",
  replied: "replied",
};

const PILL_BASE: React.CSSProperties = {
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
};

function Dot() {
  return (
    <span
      style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor", flexShrink: 0 }}
    />
  );
}

function ChannelPill({ channel, status }: { channel: string; status: ChannelStatus }) {
  return (
    <span style={{ ...PILL_BASE, ...CHANNEL_STYLE[status] }}>
      <Dot />
      {channel}: {CHANNEL_LABEL[status]}
    </span>
  );
}

export default function OutreachBadges({
  stealth,
  linkedinStatus,
  emailStatus,
}: {
  stealth: boolean;
  linkedinStatus: ChannelStatus;
  emailStatus: ChannelStatus;
}) {
  return (
    <>
      {stealth && (
        <span
          style={{
            ...PILL_BASE,
            background: "rgba(142,68,173,0.08)",
            color: "#8e44ad",
            border: "1px solid rgba(142,68,173,0.2)",
          }}
        >
          <Dot />
          stealth
        </span>
      )}
      <ChannelPill channel="li" status={linkedinStatus} />
      <ChannelPill channel="email" status={emailStatus} />
    </>
  );
}
