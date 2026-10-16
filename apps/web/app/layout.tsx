import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Skelet — Design Intelligence",
  description:
    "Skelet is the agent-first design intelligence layer: research, assets, URL Lens, and reusable evidence.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <header style={{ borderBottom: "1px solid #d4d4d4", padding: "12px 20px" }}>
          <nav
            aria-label="Skelet primary navigation"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 20px" }}
          >
            <Link href="/" style={{ fontWeight: 700 }}>Skelet</Link>
            <Link href="/gallery">Gallery</Link>
            <Link href="/flows">Flows</Link>
            <Link href="/patterns">Patterns</Link>
            <Link href="/boards">Boards</Link>
            <Link href="/lens">Lens</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
