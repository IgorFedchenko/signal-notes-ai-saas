import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Signal Notes — Make room for the important things",
  description:
    "Private notes, clear summaries, and a little more headspace. A Next.js, Supabase and Stripe reference implementation.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
