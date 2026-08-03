import Link from "next/link";
import type { Startup } from "../../lib/supabase";
import { hasEnrichmentData, isStaleRunning } from "../../lib/enrichment";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";
import StartupActions from "./StartupActions";
import { Pill, Dot } from "./ui/Pill";
import { VisitsChip, EmailChip } from "./WebAnalyticsSection";
import { CleanCheckbox } from "./ui/CleanCheckbox";

function truncate(text: string | null, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

export function StartupRow({
  startup: s,
  index,
  selected,
  onToggleSelect,
  onOpenPanel,
  onUpdate,
}: {
  startup: Startup;
  index: number;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenPanel: () => void;
  onUpdate: (partial: Partial<Startup>) => void;
}) {
  const isPassed = s.status === "passed";
  const enriched = hasEnrichmentData(s);
  const isEnriching = s.enrichment_status === "running" && !isStaleRunning(s);

  return (
    <div
      data-startup-card
      className="row-enter"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button, input, label, [data-no-nav]")) return;
        onOpenPanel();
      }}
      style={{
        animationDelay: `${Math.min(index * 22, 280)}ms`,
        border: selected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: 12,
        background: isPassed ? "rgba(255,255,255,0.45)" : selected ? "rgba(0, 122, 255, 0.035)" : "var(--card-bg)",
        boxShadow: selected
          ? "0 4px 20px rgba(0, 122, 255, 0.12), 0 0 0 1px rgba(0, 122, 255, 0.18) inset"
          : isPassed
          ? "none"
          : "0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.6) inset",
        opacity: isPassed && !selected ? 0.62 : 1,
        transform: selected ? "translateY(-1px)" : "translateY(0)",
        transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        padding: "18px 20px",
        position: "relative",
        cursor: enriched ? "pointer" : "default",
      }}
    >
      {/* Card top row: name + badges + actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ paddingTop: 2, flexShrink: 0 }} data-no-nav>
          <CleanCheckbox checked={selected} onChange={onToggleSelect} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Name + badges */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexWrap: "wrap",
              marginBottom: 3,
            }}
          >
            <Link
              href={`/startups/${s.slug}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onOpenPanel();
              }}
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--heading)",
                textDecoration: isPassed ? "line-through" : "none",
                letterSpacing: "-0.15px",
              }}
            >
              {s.name}
            </Link>
            <StatusBadge status={s.status} />
            <OutreachBadges
              stealth={s.stealth}
              linkedinStatus={s.linkedin_status}
              emailStatus={s.email_status}
              followupCount={s.followup_count}
              lastFollowupAt={s.last_followup_at}
            />
            {isEnriching && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  fontWeight: 500,
                  letterSpacing: "0.01em",
                }}
                className="live-dot"
              >
                enriching…
              </span>
            )}
            {enriched && !isEnriching && (
              <Pill
                dot={false}
                style={{
                  gap: 4,
                  fontSize: 11,
                  color: "var(--success)",
                  background: "rgba(52,199,89,0.08)",
                  border: "1px solid rgba(52,199,89,0.2)",
                  padding: "2px 8px",
                }}
              >
                <Dot size={4} />
                enriched
              </Pill>
            )}
            <VisitsChip visits={s.monthly_visits} />
            <EmailChip hasEmail={s.has_email} />
          </div>
          {/* Website */}
          {s.website && (
            <a
              href={s.website.startsWith("http://") || s.website.startsWith("https://") || s.website.startsWith("//") ? s.website : `https://${s.website}`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12,
                color: "var(--accent)",
                textDecoration: "none",
                opacity: 0.72,
              }}
            >
              {s.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>

        {/* Actions (raised so menus sit above card content) */}
        <div style={{ flexShrink: 0, position: "relative", zIndex: 20 }} data-no-nav>
          <StartupActions
            slug={s.slug}
            name={s.name}
            status={s.status}
            enrichmentStatus={s.enrichment_status}
            enrichmentError={s.enrichment_error}
            enrichmentUpdatedAt={s.updated_at}
            companyDescription={s.company_description}
            founders={s.founders}
            enriched={s.enriched}
            hasEmail={s.has_email}
            stealth={s.stealth}
            linkedinStatus={s.linkedin_status}
            emailStatus={s.email_status}
            followupCount={s.followup_count}
            lastFollowupAt={s.last_followup_at}
            onUpdate={onUpdate}
          />
        </div>
      </div>

      {/* Card body: one-liner + assessment */}
      {(s.one_liner || s.assessment) && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {s.one_liner && (
            <p
              style={{
                fontSize: 13,
                color: "var(--body)",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {truncate(s.one_liner, 180)}
            </p>
          )}
          {s.assessment && (
            <p
              style={{
                fontSize: 12,
                color: "var(--label)",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {truncate(s.assessment, 220)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
