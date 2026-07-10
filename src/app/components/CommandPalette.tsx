"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandPalette as AstryxCommandPalette,
  CommandPaletteEmpty,
  Text,
  createStaticSource,
} from "@astryxdesign/core";
import type { Startup } from "../../lib/supabase";

type Item = { id: string; label: string; auxiliaryData?: { oneLiner: string | null } };

export default function CommandPalette({ startups }: { startups: Startup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items: Item[] = useMemo(
    () =>
      startups.map((s) => ({
        id: s.slug,
        label: s.name,
        auxiliaryData: { oneLiner: s.one_liner },
      })),
    [startups]
  );

  const searchSource = useMemo(
    () =>
      createStaticSource(items, {
        keywords: (item) => (item.auxiliaryData?.oneLiner ? [item.auxiliaryData.oneLiner] : []),
      }),
    [items]
  );

  return (
    <AstryxCommandPalette
      isOpen={open}
      onOpenChange={setOpen}
      searchSource={searchSource}
      label="Search startups"
      onValueChange={(slug) => {
        setOpen(false);
        router.push(`/startups/${slug}`);
      }}
      emptyBootstrapText={<CommandPaletteEmpty>Search startups…</CommandPaletteEmpty>}
      emptySearchText={<CommandPaletteEmpty>No matches found.</CommandPaletteEmpty>}
      renderItem={(item, isSelected) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Text
            type="label"
            size="sm"
            weight={isSelected ? "semibold" : "normal"}
            color={isSelected ? "accent" : "primary"}
          >
            {item.label}
          </Text>
          {item.auxiliaryData?.oneLiner && (
            <Text type="supporting" size="xsm">
              {item.auxiliaryData.oneLiner}
            </Text>
          )}
        </div>
      )}
    />
  );
}
