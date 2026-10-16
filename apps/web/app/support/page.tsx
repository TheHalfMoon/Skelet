import Link from "next/link";

export const metadata = {
  title: "Support — Skelet",
  description:
    "How to get help with self-hosted Skelet: health checks, runbooks, issue tracker, and support boundaries.",
};

export default function Support() {
  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: "0 24px" }}>
      <h1>Support</h1>
      <p>
        Skelet is self-hosted software. There is no hosted help desk and no
        uptime commitment for operator-run instances: the operator owns
        availability, backups, and upgrades.
      </p>
      <h2>Self-service checks</h2>
      <ul>
        <li>
          <Link href="/api/health">Health endpoint</Link> for web liveness.
        </li>
        <li>Worker <code>health</code> command for queue and environment status.</li>
        <li>
          Operator runbook (<code>docs/operations/RUNBOOK.md</code>) for
          quotas, abuse triage, backup/restore, and incident minimums.
        </li>
      </ul>
      <h2>Reporting problems</h2>
      <ul>
        <li> Bugs and feature requests: the repository issue tracker.</li>
        <li>
          Security issues: follow the repository security charter; include a
          minimal reproduction, never credentials or private workspace data.
        </li>
      </ul>
      <h2>Boundaries</h2>
      <p>
        No response-time commitment applies to self-hosted instances. Managed
        hosting, paged on-call, and hosted dashboards are explicitly deferred
        until a budgeted offer exists. See the <Link href="/privacy">privacy notes</Link> and{" "}
        <Link href="/terms">terms</Link>.
      </p>
    </main>
  );
}
