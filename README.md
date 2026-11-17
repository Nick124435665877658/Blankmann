# BLANKMANN

Shared household food planner for two people. Built with React, Vite, TypeScript and Supabase.

## Features in the first release
- Shared account and household setup
- Weekly meal planning foundation and €100 household budget
- Tomato-free, histamine-aware, cream-free and vegetable-forward preferences
- Shared shopping list and pantry foundation
- Recipe library foundation
- Erfurt retailer price-history integration

## Local development
1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env.local`.
3. Fill in the Supabase URL and publishable key.
4. Run `npm install`, then `npm run dev`.

The browser client uses only the Supabase publishable key. Never put a service-role or secret key in this repository or in a VITE_ variable.

## Supabase
Project ref: `rrjsolyytdktfmrykdca` (Frankfurt / eu-central-1).

Authentication is email/password. After signing in, create a household; the app creates its owner membership and household preferences. Invite the second household member through Supabase Auth once their email address is known.

## Build
`npm run build`

## Cloudflare Pages deployment
Create a Pages project connected to this private GitHub repository and use:
- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

Add these production environment variables in Cloudflare Pages:
- `VITE_SUPABASE_URL` = `https://rrjsolyytdktfmrykdca.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` = the project's publishable key

Do not add the Supabase service-role or secret key. The app includes SPA fallback routing and a lightweight service worker for its installable PWA shell.
