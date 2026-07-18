import type { NextConfig } from "next"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@ekairos/sandbox",
    "@mongodb-js/zstd",
    "just-bash",
    "node-liblzma",
  ],
  transpilePackages: [
    "@ekairos/domain",
    "@ekairos/events",
    "@ekairos/reactor",
    "@ekairos/testing",
  ],
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.IgnorePlugin({
      resourceRegExp: /^(@mongodb-js\/zstd|node-liblzma)$/,
    }))
    return config
  },
}

export default withWorkflow(nextConfig) as NextConfig
