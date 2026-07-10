import type { Metadata } from "next";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./globals.css";
import AstryxProvider from "./providers/AstryxProvider";

export const metadata: Metadata = {
  title: "VC Research Agent",
  description: "Pre-seed AI startup discovery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AstryxProvider>{children}</AstryxProvider>
      </body>
    </html>
  );
}
