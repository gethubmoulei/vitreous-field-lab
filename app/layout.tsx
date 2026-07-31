import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "飞蚊症模拟器",
  description: "通过鼠标动作体验飞蚊症视觉模拟。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
