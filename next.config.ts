import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
