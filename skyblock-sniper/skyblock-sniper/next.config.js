/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    // Next 14 expects ROUTE paths as the keys here, not filesystem paths.
    // Only ship the compressed DB with database-backed functions. lib/db.ts
    // expands it into writable /tmp on the first request of each warm instance.
    outputFileTracingIncludes: {
      "/api/search": ["./data/skyblock.db.gz"],
      "/api/sets": ["./data/skyblock.db.gz"],
      "/api/ping": ["./data/skyblock.db.gz"],
      "/api/health": ["./data/skyblock.db.gz"],
      "/api/old": ["./data/old_dragon_pieces_clean.csv"],
    },
  },
};

export default nextConfig;
