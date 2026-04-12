import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ["@ekairos/events", "@ekairos/domain"],
};

export default withWorkflow(nextConfig) as NextConfig;
