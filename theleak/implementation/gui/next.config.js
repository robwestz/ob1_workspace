/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // serverActions enabled by default in Next.js 14
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
