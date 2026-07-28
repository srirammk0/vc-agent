import type { DealflowStatus } from "../../lib/supabase";
import { Pill, Dot } from "./ui/Pill";
import { Button } from "./ui/Button";

export function BatchToolbar({
  selectedCount,
  totalFiltered,
  batchBusy,
  onToggleSelectAll,
  onBatchStatus,
  onCancel,
}: {
  selectedCount: number;
  totalFiltered: number;
  batchBusy: string | null;
  onToggleSelectAll: () => void;
  onBatchStatus: (status: DealflowStatus) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="animate-float-up"
      style={{
        position: "fixed",
        bottom: 32,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 18px",
        background: "var(--card-bg)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.18), 0 2px 10px rgba(0, 0, 0, 0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Pill
          dot={false}
          style={{
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 9px",
            boxShadow: "0 2px 8px rgba(0, 122, 255, 0.4)",
          }}
        >
          {selectedCount}
        </Pill>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--heading)", letterSpacing: "-0.1px" }}>
          selected
        </span>
      </div>

      <div style={{ width: 1, height: 22, background: "var(--border)" }} />

      <Button variant="accent" onClick={onToggleSelectAll}>
        {selectedCount === totalFiltered ? "Deselect All" : `Select All (${totalFiltered})`}
      </Button>

      <div style={{ width: 1, height: 22, background: "var(--border)" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button variant="success" onClick={() => onBatchStatus("approved")} busy={batchBusy !== null}>
          <Dot size={6} />
          {batchBusy === "approved" ? "Approving…" : "Mark approved"}
        </Button>

        <Button
          variant="neutral"
          onClick={() => onBatchStatus("responded")}
          busy={batchBusy !== null}
          style={{ color: "#2e9b8f", borderColor: "rgba(46,155,143,0.3)" }}
        >
          <Dot size={6} />
          {batchBusy === "responded" ? "Updating…" : "Mark responded"}
        </Button>

        <Button
          variant="neutral"
          onClick={() => onBatchStatus("call_booked")}
          busy={batchBusy !== null}
          style={{ color: "#5856d6", borderColor: "rgba(88,86,214,0.3)" }}
        >
          <Dot size={6} />
          {batchBusy === "call_booked" ? "Booking…" : "Mark call booked"}
        </Button>

        <Button variant="danger" onClick={() => onBatchStatus("passed")} busy={batchBusy !== null}>
          <Dot size={6} />
          {batchBusy === "passed" ? "Passing…" : "Mark passed"}
        </Button>

        <Button variant="neutral" onClick={() => onBatchStatus("new")} busy={batchBusy !== null}>
          <Dot size={6} />
          {batchBusy === "new" ? "Resetting…" : "Mark new"}
        </Button>
      </div>

      <div style={{ width: 1, height: 22, background: "var(--border)" }} />

      <button
        onClick={onCancel}
        disabled={batchBusy !== null}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          fontSize: 13,
          fontWeight: 500,
          cursor: batchBusy !== null ? "not-allowed" : "pointer",
          padding: "5px 10px",
          borderRadius: 8,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--heading)";
          e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--muted)";
          e.currentTarget.style.background = "transparent";
        }}
        title="Clear selection"
      >
        Cancel
      </button>
    </div>
  );
}
