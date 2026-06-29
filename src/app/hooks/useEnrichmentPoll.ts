import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "../../lib/supabaseBrowser";

type EnrichmentStatus = "pending" | "running" | "complete";

export function useEnrichmentPoll(
  slug: string,
  enrichmentStatus: EnrichmentStatus
) {
  const router = useRouter();

  useEffect(() => {
    // Realtime handles live updates when configured; skip polling then.
    if (getBrowserClient()) return;
    if (enrichmentStatus !== "running") return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/startup/${slug}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.enrichment_status !== "running") {
          router.refresh();
        }
      } catch {
        // ignore transient network errors
      }
    };

    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [slug, enrichmentStatus, router]);
}
