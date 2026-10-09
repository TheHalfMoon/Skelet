import Link from "next/link";

import { cn } from "../lib/utils";

const containerClass = cn("skelet-home", "skelet-home-centered");

export default function Home() {
  return (
    <main
      className={containerClass}
      style={{ maxWidth: 720, margin: "64px auto", padding: "0 24px" }}
    >
      <h1>Skelet</h1>
      <p>
        The agent-first design intelligence layer: research, assets, URL Lens,
        and reusable evidence for humans and AI agents.
      </p>
      <p>
        <Link href="/api/health">Health endpoint</Link>
        {" · "}
        <Link href="/api/registry">Component registry</Link>
      </p>
    </main>
  );
}
