"use client";

import Link from "next/link";
import type { Startup } from "../../lib/supabase";
import { useLiveStartup } from "../hooks/useLiveStartup";
import StartupDetailBody from "./StartupDetailBody";

export default function StartupDetailClient({ initial }: { initial: Startup }) {
  const { startup, updateLocal } = useLiveStartup(initial);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--page-bg)",
        color: "var(--body)",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 60px" }}>
        <Link href="/" className="back-link" style={{ marginBottom: 28, display: "inline-flex" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
          </svg>
          Dealflow
        </Link>

        <StartupDetailBody startup={startup} onUpdate={updateLocal} />
      </div>
    </main>
  );
}
