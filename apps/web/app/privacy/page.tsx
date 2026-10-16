import Link from "next/link";

export const metadata = {
  title: "Privacy — Skilit",
  description:
    "How Skilit handles workspace data: local-first storage, workspace isolation, redaction, and no third-party AI egress on qualified paths.",
};

export default function Privacy() {
  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: "0 24px" }}>
      <h1>Privacy</h1>
      <p>
        Skilit is local-first and self-hosted. Workspace data lives in the
        operator&apos;s own PostgreSQL database and content-addressed store —
        not in a founder-hosted cloud account.
      </p>
      <h2>What stays local</h2>
      <ul>
        <li>Collections, reference packs, flows, patterns, and Lens reports.</li>
        <li>Credentials and bearer tokens, which never enter logs, error messages, or exports.</li>
        <li>Replay events, whose sensitive input values are masked before storage.</li>
      </ul>
      <h2>What never happens on qualified paths</h2>
      <ul>
        <li>No workspace content is sent to third-party AI providers.</li>
        <li>No ambient credentials reach capture workers or editor adapters.</li>
        <li>Unknown, trademark-restricted, or withheld bytes are served as empty or denied — never leaked through search, preview, export, or pack paths.</li>
      </ul>
      <h2>Operator responsibilities</h2>
      <p>
        Operators control backups, access to the host, and any optional
        customer-funded hosting. See the <Link href="/support">support page</Link> for
        incident pointers and <Link href="/terms">terms</Link> for the
        governing posture.
      </p>
    </main>
  );
}
