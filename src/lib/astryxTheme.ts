import { defineTheme } from "@astryxdesign/core/theme";

// Mirrors the palette that used to live in globals.css (:root) so the
// astryx-based revamp keeps the same look: warm off-white page, blue
// accent, Apple system font stack.
export const vcScoutTheme = defineTheme({
  name: "vc-scout",
  color: { accent: "#007aff", neutralStyle: "warm", contrast: "standard" },
  radius: { base: 4, multiplier: 1 },
  typography: {
    body: {
      family: "-apple-system",
      fallbacks:
        '"SF Pro Display", "SF Pro", system-ui, "Helvetica Neue", Arial, sans-serif',
    },
  },
  tokens: {
    "--color-background-body": "#F9F9EF",
    "--color-background-card": "#ffffff",
    "--color-background-surface": "#f2f2f7",
    "--color-text-primary": "#061f00",
    "--color-text-secondary": "#6b6760",
    "--color-border": "rgba(0, 0, 0, 0.07)",
    "--color-success": "#34c759",
    "--color-error": "#ff3b30",
    "--color-warning": "#ff9500",
  },
});
