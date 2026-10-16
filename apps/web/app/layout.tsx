import type { Metadata } from "next";
import "./globals.css";
import { SkilitShell } from "../components/skilit-shell";

export const metadata: Metadata = {
  applicationName: "Skilit",
  title: {
    default: "Skilit — Design intelligence, made usable",
    template: "%s | Skilit",
  },
  description:
    "Skilit is a local-first design intelligence workspace. Capture design evidence, build reusable patterns, and work seamlessly with agents.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SkilitShell>{children}</SkilitShell>
      </body>
    </html>
  );
}
