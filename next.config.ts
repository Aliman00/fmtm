import type { NextConfig } from "next";

// Tillater Supabase Realtime WebSockets, egen origin for statiske ressurser,
// og bilder. Linjen nedenfor definerer en stram CSP — utvid hvis du legger til
// tredjepartstjenester (f.eks. analytics, ekstern font-CDN).
const supabaseHosts = [
  "https://*.supabase.co",
  "wss://*.supabase.co",
];

// 'unsafe-eval' tillater React sin eval()-baserte stack-rekonstruksjon i
// development. Aldri nødvendig i production — React bruker aldri eval() der.
const scriptSrc = process.env.NODE_ENV === "development"
  ? `'self' 'unsafe-inline' 'unsafe-eval' ${supabaseHosts.join(" ")}`
  : `'self' 'unsafe-inline' ${supabaseHosts.join(" ")}`;

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseHosts.join(" ")}`,
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Blokkerer plugin-innhold (Flash, Java) og eksplisitte workers eksternt.
  // Vår service worker lever på samme origin, så 'self' er korrekt.
  "object-src 'none'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
