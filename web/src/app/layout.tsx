import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthShell } from "../components/auth-shell";
import { BrandingProvider } from "../components/branding";

export const metadata: Metadata = {
  title: "Ecomkit - Vui Khỏe",
  description: "Ecomkit foundation environment",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <BrandingProvider>
          <AuthShell>{children}</AuthShell>
        </BrandingProvider>
      </body>
    </html>
  );
}
