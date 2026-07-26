export const PILL_BASE: React.CSSProperties = {
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

export function Dot({ size = 5 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: 999, background: "currentColor", flexShrink: 0 }}
    />
  );
}

export function Pill({
  style,
  dot = true,
  title,
  children,
}: {
  style: React.CSSProperties;
  dot?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span style={{ ...PILL_BASE, ...style }} title={title}>
      {dot && <Dot />}
      {children}
    </span>
  );
}
