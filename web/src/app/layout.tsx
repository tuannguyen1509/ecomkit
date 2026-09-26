import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthShell } from "../components/auth-shell";

export const metadata: Metadata = {
  title: "Ecomkit - Vui Khỏe",
  description: "Ecomkit foundation environment"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body><AuthShell>{children}</AuthShell></body>
    </html>
  );
}
