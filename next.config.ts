import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  experimental: {},
  compiler: {
    styledComponents: true,
  },
  webpack(config) {
    // click-ui bundles code that accesses React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    // which was removed in React 19. Transform it to use safe access via a custom loader.
    config.module.rules.push({
      test: /node_modules\/@clickhouse\/click-ui\/dist\/click-ui\.es\.js$/,
      loader: path.resolve(__dirname, 'lib/click-ui-react19-loader.js'),
    })
    return config
  },
}

export default nextConfig
