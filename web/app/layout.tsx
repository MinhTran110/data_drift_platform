import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased font-sans">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-lg shadow-sm">
                Δ
              </div>
              <div>
                <Link href="/dashboard" className="text-sm font-bold text-slate-900 hover:text-blue-600">
                  DriftOps Platform
                </Link>
                <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  Batch 6h
                </span>
              </div>
            </div>

            <nav className="flex items-center gap-6 text-xs font-medium text-slate-600">
              <Link href="/dashboard" className="hover:text-blue-600 transition-colors">
                Dashboard
              </Link>
              <Link href="/retrain" className="hover:text-blue-600 transition-colors">
                Model Retraining & Governance
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 text-slate-700 transition-colors"
              >
                GitHub Actions
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>

        <footer className="mt-12 border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          <p>
            Near-real-time batch ML drift monitoring platform • PSI &amp; KS statistical quantification • Closed-loop retraining
          </p>
        </footer>
      </body>
    </html>
  );
}
