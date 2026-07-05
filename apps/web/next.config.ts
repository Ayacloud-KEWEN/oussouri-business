import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Windows 本机构建无符号链接权限，standalone 仅在 Docker(Linux) 构建时启用
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async rewrites() {
    // 开发环境将 /api/v1 代理到 NestJS，避免 CORS；生产由 Nginx 反代
    return [{ source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://localhost:3001"}/v1/:path*` }];
  },
};

export default nextConfig;
