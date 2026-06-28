import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VC Research Agent",
  description: "Pre-seed AI startup discovery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "#f4f4f0", minHeight: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
