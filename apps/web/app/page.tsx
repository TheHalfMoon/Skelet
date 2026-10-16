import Link from "next/link";

const features = [
  { href: "/gallery", title: "Gallery", description: "Browse products and their versions within your access scope." },
  { href: "/flows", title: "Flows & replays", description: "Inspect captured flows and consented replay sessions." },
  { href: "/patterns", title: "Patterns", description: "Explore design patterns and linked evidence." },
  { href: "/boards", title: "Boards", description: "Collect and organize evidence in workspace reference boards." },
  { href: "/lens", title: "Lens Build Kit", description: "Inspect local URL-to-report and Build Kit jobs." },
] as const;

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Skelet</h1>
      <p>
        A local-first design intelligence workspace for people and AI agents:
        research, assets, URL Lens, and reusable evidence.
      </p>

      <nav aria-label="Explore Skelet">
        <h2>Explore</h2>
        <ul style={{ display: "grid", gap: 12, paddingLeft: 24 }}>
          {features.map(({ href, title, description }) => (
            <li key={href}>
              <Link href={href}>{title}</Link>
              <div style={{ color: "#555", marginTop: 2 }}>{description}</div>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="access-heading">
        <h2 id="access-heading">Access</h2>
        <p>
          These workspace views require an authorized session bearer token to
          read private data. The current local version uses operator-provisioned
          tokens; a browser sign-in screen is not yet provided. No AI service
          or paid account is required to explore the interface.
        </p>
      </section>

      <nav aria-label="Documentation and service links">
        <h2>Information</h2>
        <p>
          <Link href="/api/health">Health</Link>{" · "}
          <Link href="/api/registry">Component registry</Link>{" · "}
          <Link href="/privacy">Privacy</Link>{" · "}
          <Link href="/terms">Terms</Link>{" · "}
          <Link href="/support">Support</Link>
        </p>
      </nav>
    </main>
  );
}
