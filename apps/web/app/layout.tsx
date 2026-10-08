import type { Metadata } from "next";

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
        {children}
      </body>
    </html>
  );
}
