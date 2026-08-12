import type { Metadata } from "next";

import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "LastWish — Programmable asset succession", template: "%s · LastWish" },
  description: "A self-custodial digital-asset succession vault with owner heartbeats, guardian veto, and KeeperHub execution.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
