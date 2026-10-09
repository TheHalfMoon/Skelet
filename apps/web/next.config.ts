import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite stays out of the bundle via lazy loading in packages/db;
  // pg is pure JavaScript and bundles cleanly.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
