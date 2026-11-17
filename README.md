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
