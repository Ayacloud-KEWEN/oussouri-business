import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // 开发环境将 /api/v1 代理到 NestJS，避免 CORS；生产由 Nginx 反代
    return [{ source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://localhost:3001"}/v1/:path*` }];
  },
};

export default nextConfig;
