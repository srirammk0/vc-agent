type Variant = "accent" | "success" | "danger" | "neutral" | "ghost";

const VARIANT_STYLE: Record<Variant, React.CSSProperties> = {
  accent: {
    background: "rgba(0, 122, 255, 0.08)",
    border: "1px solid rgba(0, 122, 255, 0.25)",
    color: "var(--accent)",
  },
  success: {
    background: "rgba(52, 199, 89, 0.12)",
    border: "1px solid rgba(52, 199, 89, 0.3)",
    color: "#1e9e4a",
  },
  danger: {
    background: "rgba(255, 59, 48, 0.1)",
    border: "1px solid rgba(255, 59, 48, 0.3)",
    color: "#d9291f",
  },
  neutral: {
    background: "rgba(0, 0, 0, 0.04)",
    border: "1px solid var(--border-med)",
    color: "var(--label)",
  },
  ghost: {
    background: "transparent",
    border: "none",
    color: "var(--muted)",
  },
};

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  busy?: boolean;
};

/** Wraps the shared .hud-btn shape/hover/active transitions (globals.css) with
 * per-variant color + disabled/busy opacity — the part every call site used to
 * repeat inline. */
export function Button({ variant = "neutral", busy, disabled, style, children, ...rest }: Props) {
  const isDisabled = disabled || busy;
  return (
    <button
      className="hud-btn"
      disabled={isDisabled}
      style={{
        ...VARIANT_STYLE[variant],
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
