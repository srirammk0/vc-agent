import Link from "next/link";
import { supabase, type Startup } from "../lib/supabase";
import StatusBadge from "./components/StatusBadge";
import StartupActions from "./components/StartupActions";

export const dynamic = "force-dynamic";

type Tab = "all" | "new" | "approved" | "passed";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "approved", label: "Approved" },
  { id: "passed", label: "Passed" },
];

function truncate(text: string | null, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (["all", "new", "approved", "passed"].includes(tabParam || "")
    ? tabParam
    : "all") as Tab;

  const { data } = await supabase
    .from("startups")
    .select("*")
    .order("found_date", { ascending: false });

  const startups = (data ?? []) as Startup[];

  const counts = {
    new: startups.filter((s) => s.status === "new").length,
    approved: startups.filter((s) => s.status === "approved").length,
    passed: startups.filter((s) => s.status === "passed").length,
  };

  const filtered =
    tab === "all" ? startups : startups.filter((s) => s.status === tab);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FFFFFF",
        color: "#171717",
        fontFamily:
          "'Aeonik Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          height: 58,
          background: "#000000",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <span style={{ fontSize: 16 }}>VC Scout</span>
        <div style={{ display: "flex", gap: 20, fontSize: 13, color: "#CCCCCC" }}>
          <span>{counts.new} new</span>
          <span style={{ color: "#86FC6F" }}>{counts.approved} approved</span>
          <span>{counts.passed} passed</span>
        </div>
      </nav>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 32, lineHeight: "44px", margin: "0 0 24px" }}>
          Dealflow
        </h1>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 32,
            borderBottom: "1px solid #E8E8E8",
            marginBottom: 24,
          }}
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <Link
                key={t.id}
                href={t.id === "all" ? "/" : `/?tab=${t.id}`}
                style={{
                  padding: "12px 0",
                  fontSize: 14,
                  color: active ? "#171717" : "#999999",
                  borderBottom: active
                    ? "2px solid #007AFF"
                    : "2px solid transparent",
                  textDecoration: "none",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div
            style={{
              border: "1px solid #F0F0F0",
              borderRadius: 12,
              padding: 48,
              textAlign: "center",
              color: "#616061",
              fontSize: 14,
            }}
          >
            No startups here yet.
          </div>
        ) : (
          <div
            style={{
              border: "1px solid #F0F0F0",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.08)",
            }}
          >
            {filtered.map((s, i) => (
              <div
                key={s.slug}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 0.8fr 2fr 0.8fr auto",
                  gap: 16,
                  alignItems: "center",
                  padding: "16px 24px",
                  borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/startups/${s.slug}`}
                    style={{
                      fontSize: 14,
                      color: "#171717",
                      textDecoration: "none",
                      display: "block",
                    }}
                  >
                    {s.name}
                  </Link>
                  {s.website && (
                    <a
                      href={s.website}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 12,
                        color: "#007AFF",
                        textDecoration: "none",
                      }}
                    >
                      {s.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
                <div>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 13, color: "#616061", minWidth: 0 }}>
                  <div style={{ color: "#171717" }}>{truncate(s.one_liner, 80)}</div>
                  <div style={{ marginTop: 4 }}>{truncate(s.assessment, 120)}</div>
                </div>
                <div style={{ fontSize: 12, color: "#999999" }}>
                  {s.found_date}
                </div>
                <StartupActions
                  slug={s.slug}
                  name={s.name}
                  status={s.status}
                  enrichmentStatus={s.enrichment_status}
                  companyDescription={s.company_description}
                  founders={s.founders}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
