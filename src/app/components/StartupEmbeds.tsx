"use client";

import { useEffect, useRef, useState } from "react";
import type { Founder } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";
import {
  collectLinkedInTargets,
  websiteEmbedUrl,
  type LinkedInTarget,
} from "../../lib/startupEmbeds";
import { hostLabel, toHref } from "../../lib/urls";

type Props = {
  website: string | null;
  founders: Founder[] | null;
  enrichmentFields: Parameters<typeof hasEnrichmentData>[0];
};

type FrameState = "idle" | "loading" | "ready";

function LazySiteFrame({
  src,
  title,
  subtitle,
  height = 380,
}: {
  src: string;
  title: string;
  subtitle: string;
  height?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [state, setState] = useState<FrameState>("idle");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          setState("loading");
          obs.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (state !== "loading") return;
    const timer = setTimeout(() => {
      setState((s) => (s === "loading" ? "ready" : s));
    }, 12000);
    return () => clearTimeout(timer);
  }, [state]);

  const href = toHref(src);

  return (
    <div className="startup-embed" ref={rootRef}>
      <div className="startup-embed-head">
        <div>
          <div className="startup-embed-title">{title}</div>
          <div className="startup-embed-sub">{subtitle}</div>
        </div>
        <a className="startup-embed-open" href={href} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <div className="startup-embed-frame" style={{ height }}>
        {active ? (
          <>
            {state === "loading" && <div className="startup-embed-skeleton" />}
            <iframe
              src={href}
              title={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
              onLoad={() => setState("ready")}
            />
          </>
        ) : (
          <div className="startup-embed-skeleton" />
        )}
        {state === "ready" && (
          <div className="startup-embed-fade" aria-hidden />
        )}
      </div>
    </div>
  );
}

export function LinkedInPreview({
  target,
  height = 320,
}: {
  target: LinkedInTarget;
  height?: number;
}) {
  return (
    <div className="startup-embed-frame startup-embed-frame-linkedin" style={{ height }}>
      <iframe
        src={target.url}
        title={`${target.label} on LinkedIn`}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}

export default function StartupEmbeds({ website, founders, enrichmentFields }: Props) {
  const enriched = hasEnrichmentData(enrichmentFields);
  const siteUrl = websiteEmbedUrl(website);
  const companyLinkedIn = collectLinkedInTargets(founders, website).filter((t) => t.kind === "company");

  if (!enriched || (!siteUrl && companyLinkedIn.length === 0)) return null;

  return (
    <section className="startup-embeds">
      {siteUrl && (
        <LazySiteFrame
          src={siteUrl}
          title="Website"
          subtitle={hostLabel(siteUrl)}
          height={400}
        />
      )}
      {companyLinkedIn.map((target) => (
        <LinkedInPreview key={target.url} target={target} />
      ))}
    </section>
  );
}
