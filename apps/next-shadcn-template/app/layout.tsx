import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: {
    default: 'Shop',
    template: '%s · Shop',
  },
  description: 'SSR catalog served by Next.js. Admin and checkout stay on the Vite + Hono app.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui', margin: 0 }}>
        {children}
      </body>
    </html>
  )
}
