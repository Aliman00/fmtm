# Deploy til Vercel

Vercel er det enkleste stedet å hoste denne Next.js-appen — null config, gratis for et lite internt verktøy.

## 1. Push koden til Git

Vercel bygger fra et Git-repo. Hvis du ikke har gjort det allerede:

```bash
git init
git add .
git commit -m "Initial deploy"
git remote add origin <din-github-repo-url>
git push -u origin main
```

## 2. Opprett Vercel-prosjekt

1. Gå til [vercel.com/new](https://vercel.com/new)
2. Importer repoet ditt
3. Vercel oppdager automatisk at det er Next.js — ikke endre noe
4. **Ikke trykk Deploy ennå** — vi må sette miljøvariabler først

## 3. Miljøvariabler

I prosjekt-innstillingene, gå til **Settings → Environment Variables** og legg til:

| Navn | Verdi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prosjekt-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key fra Supabase → Settings → API |

Disse er trygge å ha i klient-bundle (de har `NEXT_PUBLIC_`-prefikset).

## 4. Oppdater Supabase Auth-URL-er

Etter at Vercel har gitt deg en URL (f.eks. `https://fmtm.vercel.app`):

1. Gå til **Supabase → Authentication → URL Configuration**
2. Sett **Site URL** til `https://fmtm.vercel.app`
3. Under **Redirect URLs**, legg til `https://fmtm.vercel.app/**`

## 5. Deploy

Trykk **Deploy** i Vercel. Den første byggingen tar ~1 minutt.

For hver fremtidige endring:

```bash
git push
```

Vercel bygger og deployer automatisk. Brancher får egen preview-URL.

## 6. Egendomain (valgfritt)

Under **Settings → Domains** kan du legge til et custom-domene (f.eks. `app.team6.no`). Supabase Auth-URL-ene oppdateres tilsvarende.

## Etter deploy

- Sjekk at innlogging med OTP fungerer fra den nye URL-en
- Test at realtime-oppdateringer fungerer mellom to enheter
- Sjekk Network-tab i DevTools at Supabase-API-kall går gjennom
