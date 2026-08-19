import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Første mann til mølla",
  description: "Koordiner kortbyttet med teamet.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#17234b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="no">
      <head>
        <link rel="icon" href="/icon.png" type="image/png" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ("serviceWorker" in navigator) { window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
