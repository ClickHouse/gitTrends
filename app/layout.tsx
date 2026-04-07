import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import { GoogleTagManager } from '@next/third-parties/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'block' })

export const metadata: Metadata = {
  title: 'GitTrends — ClickHouse Full-Text Search Demo',
  description:
    'Explore 10B+ GitHub events using ClickHouse full-text search with inverted indexes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <GoogleTagManager gtmId="GTM-T55CC768" />
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
