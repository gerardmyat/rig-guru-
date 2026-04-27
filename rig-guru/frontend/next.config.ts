import type { NextConfig } from 'next';

/** Where Next.js forwards `/__rigguru_api/*` (server-side — not exposed to the browser). */
const backendInternal =
    (process.env.BACKEND_INTERNAL_URL || process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000').replace(
        /\/+$/,
        ''
    );

const nextConfig: NextConfig = {
    async rewrites() {
        return [
            {
                source: '/__rigguru_api/:path*',
                destination: `${backendInternal}/:path*`,
            },
        ];
    },
};

export default nextConfig;
