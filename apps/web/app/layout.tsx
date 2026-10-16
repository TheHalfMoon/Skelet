import type { Metadata } from "next";
import "./globals.css";
import { SkilitShell } from "../components/skilit-shell";

// Local deployments default to their own address. Public instances should
// explicitly set the origin so preview images never point to localhost.
const metadataBase = new URL(process.env.SKILIT_METADATA_ORIGIN ?? "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
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
  openGraph: {
    type: "website",
    siteName: "Skilit",
    title: "Skilit — Design intelligence, made usable",
    description: "Explore evidence-grounded design intelligence with Skilit, the local-first workspace for humans and AI agents.",
    images: [
      {
        url: "/brand/skilit-social-light.png",
        width: 1200,
        height: 630,
        alt: "Skilit, the design intelligence workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Skilit — Design intelligence, made usable",
    description: "Local-first design intelligence for humans and AI agents.",
    images: ["/brand/skilit-social-light.png"],
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
