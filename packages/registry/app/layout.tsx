import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegistryTopbar } from "@/components/layout/registry-topbar";
import "./globals.css";
import { RegistrySessionProvider } from "@/lib/registry-session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ekairos Registry | Domain UI",
  description:
    "Domain-first registry for Ekairos UI primitives, installable shadcn components, and package-backed runtime dependencies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <RegistrySessionProvider>
          <RegistryTopbar />
          <div className="pt-14">{children}</div>
        </RegistrySessionProvider>
      </body>
    </html>
  );
}
