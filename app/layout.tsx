import type { Metadata } from "next";
import "./globals.css";
import { SWRProvider } from "@/lib/providers/SWRProvider";
import { AuthProvider } from "@/lib/providers/AuthProvider";

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
      <body>
        <AuthProvider>
          <SWRProvider>{children}</SWRProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
