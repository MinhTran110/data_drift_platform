import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Data Drift Monitoring & Closed-Loop Retraining Platform",
  description: "Near-real-time batch monitoring, PSI drift quantification, and automated retraining governance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md transition-colors">
              <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg shadow-sm">
                    Δ
                  </div>
                  <div>
                    <Link href="/dashboard" className="text-sm font-bold text-foreground hover:text-primary transition-colors">
                      DriftOps Platform
                    </Link>
                    <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                      Batch 6h
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                  <nav className="flex items-center gap-4 sm:gap-6 text-xs font-medium text-muted-foreground">
                    <Link href="/dashboard" className="hover:text-foreground transition-colors">
                      Dashboard
                    </Link>
                    <Link href="/ingest" className="hover:text-foreground transition-colors">
                      Data Ingestion
                    </Link>
                    <Link href="/retrain" className="hover:text-foreground transition-colors">
                      Model Governance
                    </Link>
                    <a
                      href="https://github.com"
                      target="_blank"
                      rel="noreferrer"
                      className="hidden sm:inline-flex rounded-lg border border-border px-3 py-1.5 hover:bg-accent text-foreground transition-colors"
                    >
                      GitHub Actions
                    </a>
                  </nav>

                  <div className="border-l border-border pl-3 sm:pl-4">
                    <ThemeToggle />
                  </div>
                </div>
              </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>

            <footer className="mt-12 border-t border-border bg-card py-6 text-center text-xs text-muted-foreground transition-colors">
              <p>
                Near-real-time batch ML drift monitoring platform • PSI &amp; KS statistical quantification • Closed-loop retraining
              </p>
            </footer>

            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

