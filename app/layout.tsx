import type { Metadata } from "next";
import "./globals.css";
import "./selection.css";
import "./data-map.css";

export const metadata: Metadata = {
  title: "AI Log Explorer",
  description: "Private, local exploration for AI agent histories.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
