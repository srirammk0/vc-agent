export function CleanCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && onChange) onChange();
      }}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        border: checked ? "1px solid var(--accent)" : "1.5px solid var(--border-med)",
        background: checked ? "var(--accent)" : "rgba(255, 255, 255, 0.9)",
        boxShadow: checked
          ? "0 2px 8px rgba(0, 122, 255, 0.35)"
          : "0 1px 2px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {checked && (
        <svg
          className="animate-check"
          width="11"
          height="9"
          viewBox="0 0 11 9"
          fill="none"
          style={{
            stroke: "#ffffff",
            strokeWidth: 2.2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        >
          <path d="M1 4.5L4 7.5L10 1.5" />
        </svg>
      )}
    </div>
  );
}
