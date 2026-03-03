import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'GitSearch — ClickHouse Full-Text Search Demo',
  description:
    'Explore 10B+ GitHub events using ClickHouse full-text search with inverted indexes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
