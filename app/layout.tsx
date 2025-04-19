import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "AI PDF Challenge",
  description: "AI-powered PDF processing application",
  icons: {
    icon: "/favicon.ico",
  },
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geistSans.className} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <header className="w-full border-b border-gray-200">
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">
              <Link href="/" className="font-semibold text-xl">
                PDF Search App
              </Link>
              <nav className="flex gap-4">
                <Link href="/" className="hover:text-gray-600">
                  Home
                </Link>
                <Link href="/pdf-search" className="hover:text-gray-600">
                  PDF Search
                </Link>
              </nav>
            </div>
          </header>
          <main className="min-h-screen flex flex-col items-center">
            <div className="flex-1 w-full flex flex-col items-center">
              {children}
            </div>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
