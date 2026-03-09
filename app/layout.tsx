import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import Analytics from './analytics'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'block' })

export const metadata: Metadata = {
  title: 'GitTrends — ClickHouse Full-Text Search Demo',
  description:
    'Explore 10B+ GitHub events using ClickHouse full-text search with inverted indexes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <Analytics>
          <Providers>{children}</Providers>
        </Analytics>
      </body>
    </html>
  )
}
