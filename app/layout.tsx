import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import Analytics from './analytics'
import Script from 'next/script';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'block' })

export const metadata: Metadata = {
  title: 'GitTrends — ClickHouse Full-Text Search Demo',
  description:
    'Explore 10B+ GitHub events using ClickHouse full-text search with inverted indexes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <Script
        defer
        data-skip-css="false"
        src="https://cdn-prod.securiti.ai/consent/cookie-consent-sdk-loader-strict-csp.js"
        data-tenant-uuid="8555e54b-cd0b-45d7-9c1c-e9e088bf774a"
        data-domain-uuid="03e5394d-77f1-4eff-8ca4-f893359476e5"
        data-backend-url="https://app.securiti.ai"
      />
      <body className={inter.className}>
        <Providers><Analytics>{children}</Analytics></Providers>
      </body>
    </html>
  )
}
