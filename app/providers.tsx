'use client'

import { ClickUIProvider } from '@clickhouse/click-ui'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClickUIProvider theme="dark">
      {children}
    </ClickUIProvider>
  )
}
