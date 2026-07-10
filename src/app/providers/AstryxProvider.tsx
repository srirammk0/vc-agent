"use client";

import { LayerProvider, Theme } from "@astryxdesign/core";
import { vcScoutTheme } from "../../lib/astryxTheme";

export default function AstryxProvider({ children }: { children: React.ReactNode }) {
  return (
    <LayerProvider toast={{ position: "bottomEnd", maxVisible: 3 }}>
      <Theme theme={vcScoutTheme} mode="light">
        {children}
      </Theme>
    </LayerProvider>
  );
}
