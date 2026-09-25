import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui/Toast";
import { RouteTitle } from "@/components/shell/RouteTitle";
import { DemoGuide } from "@/components/DemoGuide";
import "./globals.css";

// One family. Archivo has a real ₦ glyph (many Google fonts don't) and a width
// axis, which lets a seven-figure balance run narrow and huge on a phone.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BlazeSync", template: "%s | BlazeSync" },
  description: "Association dues on one shared, live ledger. Members see what the treasurer sees, and no payout leaves without co-signatures.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171b33" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className={`${archivo.variable} h-full`}>
      <body className="min-h-full">
        <StoreProvider>
          <ToastProvider>{children}</ToastProvider>
          <RouteTitle />
          <DemoGuide />
        </StoreProvider>
      </body>
    </html>
  );
}
