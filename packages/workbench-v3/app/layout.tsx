import type { Metadata } from "next"

import "@fontsource-variable/inter"
import "@fontsource-variable/geist-mono"

import "./globals.css"

export const metadata: Metadata = {
  title: "Ekairos Workbench v3",
  description: "Live Context, Reaction, Event, Part, and InstantDB stream traces.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
