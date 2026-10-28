/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * next.config.mjs
 * Copyright (C) 2025 Nextify Limited
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import {initOpenNextCloudflareForDev} from "@opennextjs/cloudflare";

// Enable Cloudflare context only for local next dig — skip on public/prod hosts.
if (process.env.NODE_ENV === 'development' && process.env.ENVIRONMENT !== 'production') {
    initOpenNextCloudflareForDev();
}

// Dynamic import for bundle analyzer to handle ESM/CommonJS compatibility
const withBundleAnalyzer = (await import('@next/bundle-analyzer')).default({
    enabled: process.env.ANALYZE === 'true',
    openAnalyzer: true,
});

const isDevelopment = process.env.NODE_ENV === 'development'
const isPublicHost = process.env.ENVIRONMENT === 'production'
const paraglideWebpackPlugin = isDevelopment
    ? null
    : (await Function('specifier', 'return import(specifier)')('@inlang/paraglide-js')).paraglideWebpackPlugin

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // Hide Next.js "N" / issues badge on the public site.
    ...(isPublicHost || !isDevelopment ? { devIndicators: false } : {}),
    allowedDevOrigins: ['websitebuilder.techspireglobal.com', 'techspireglobal.com'],
    transpilePackages: ["@quickxbuild/ui", "@quickxbuild/auth", "@quickxbuild/db", "@quickxbuild/api", "@quickxbuild/common"
        , "@quickxbuild/better-auth-cloudflare", "@quickxbuild/email","@quickxbuild/better-auth-stripe","@quickxbuild/shikicode"
    ,"@quickxbuild/sandbox"],
    pageExtensions: ['ts', 'tsx'],
    experimental: isDevelopment
        ? {}
        : process.env.LIGHT_NEXT_BUILD === '1'
          ? {
              // Low-RAM / VPS-friendly production build
            }
          : {
              reactCompiler: true,
              useCache: true,
              // ppr: true,
            },
    // Smaller Node server image for VPS deploys
    ...(process.env.LIGHT_NEXT_BUILD === '1' || process.env.NEXT_OUTPUT_STANDALONE === '1'
      ? { output: 'standalone' }
      : {}),
    // VPS light builds: skip typecheck so a prebuilt .next can ship (compile already succeeded)
    ...(process.env.LIGHT_NEXT_BUILD === '1'
      ? {
          typescript: { ignoreBuildErrors: true },
          eslint: { ignoreDuringBuilds: true },
        }
      : {}),
    images: {
      loader: 'custom',
      loaderFile: './imageLoader.ts',
      remotePatterns: [
        {
          protocol: 'http',
          hostname: 'localhost',
          port: '3004',
          pathname: '/image/**',
        },
        {
            protocol: 'https',
            hostname: 'cdn.quickxbuild.dev',
            pathname: '/image/**',
        },
        {
            protocol: 'https',
            hostname: 'websitebuilder.techspireglobal.com',
            pathname: '/image/**',
        }
      ],
    },
    webpack: (config) => {
        if (paraglideWebpackPlugin) {
            config.plugins.push(
                paraglideWebpackPlugin({
                    outdir: "./paraglide",
                    project: "./project.inlang",
                    strategy: ["baseLocale"],
                    experimentalMiddlewareLocaleSplitting: false,
                })
            );
        }
			return config;
    },
    serverExternalPackages: ["@prisma/client", ".prisma/client", "postgres", "@libsql/isomorphic-ws", "jose"],
    async rewrites() {
        const viteBase = (process.env.VITE_BASE || '').trim()
        if (!viteBase || viteBase === '/') {
            return []
        }
        const target = (process.env.LOCAL_PREVIEW_PROXY_TARGET || 'http://127.0.0.1:5174').replace(/\/$/, '')
        const prefix = viteBase.endsWith('/') ? viteBase.slice(0, -1) : viteBase
        return [
            {
                source: prefix,
                destination: `${target}${prefix}/`,
            },
            {
                source: `${prefix}/:path*`,
                destination: `${target}${prefix}/:path*`,
            },
        ]
    },
}

export default withBundleAnalyzer(nextConfig)
