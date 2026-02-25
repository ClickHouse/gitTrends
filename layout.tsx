import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GitSearch — ClickHouse Full-Text Search Demo',
  description:
    'Explore 10B+ GitHub events using ClickHouse full-text search with inverted indexes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
