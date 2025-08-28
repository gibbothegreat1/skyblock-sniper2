/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    // ⬇️ Ensure the SQLite file is bundled into EVERY app/api/** lambda
    outputFileTracingIncludes: {
      "app/api/**": [
        "./data/skyblock.db",
        "./data/**/*",        // include the whole folder just in case
      ],
    },
  },
};

export default nextConfig; // (or module.exports = nextConfig for .cjs)
