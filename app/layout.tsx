import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rally Panties DesignOps",
  description: "AI-Powered Design + Mockup + Shopify Publisher",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
