import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "LastWish — Programmable asset succession", template: "%s · LastWish" },
  description: "A self-custodial digital-asset succession vault with owner heartbeats, guardian veto, and KeeperHub execution.",
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = { themeColor: "#17211c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
