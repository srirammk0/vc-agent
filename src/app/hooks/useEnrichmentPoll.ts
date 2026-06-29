import { useEffect } from "react";
import { useRouter } from "next/navigation";

type EnrichmentStatus = "pending" | "running" | "complete";

export function useEnrichmentPoll(
  slug: string,
  enrichmentStatus: EnrichmentStatus
) {
  const router = useRouter();

  useEffect(() => {
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
