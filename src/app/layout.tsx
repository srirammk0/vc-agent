import type { Metadata } from "next";
import "./globals.css";
import ScrollRestoration from "./components/ScrollRestoration";

export const metadata: Metadata = {
  title: "VC Research Agent",
  description: "Pre-seed AI startup discovery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <ScrollRestoration />
        {children}
      </body>
    </html>
  );
}
