/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@sparticuz/chromium", "puppeteer-core"],
    outputFileTracingIncludes: {
      "app/api/**": [
        "./data/skyblock.db",
        "./data/**/*",
      ],
      "app/api/check-exotico/**": [
        "./node_modules/@sparticuz/chromium/bin/**/*",
      ],
    },
  },
};

export default nextConfig;
