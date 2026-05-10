import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { WalletContextProvider } from "@/contexts/WalletContext";
import { Navbar } from "@/components/Navbar";
import { ToastContainer } from "@/components/Toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Fundex — Funding Rate Swap Market",
  description: "Trade funding rate swaps on Solana. Go long or short on perpetual funding rates.",
  metadataBase: new URL("https://fundex-weld.vercel.app"),
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Fundex — Funding Rate Swap Market",
    description: "Trade funding rate swaps on Solana. Go long or short on perpetual funding rates.",
    url: "https://fundex-weld.vercel.app",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fundex — Funding Rate Swap Market",
    description: "Trade funding rate swaps on Solana. Go long or short on perpetual funding rates.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} style={{ background: "#08090e" }}>
      <body className="h-full antialiased" style={{ background: "#08090e" }}>
        <WalletContextProvider>
          <Navbar />
          <main className="pt-14 min-h-screen">{children}</main>
          <ToastContainer />
        </WalletContextProvider>
      </body>
    </html>
  );
}
