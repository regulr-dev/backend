# Regulr Backend — Developer & Claude Guide

This repository contains the backend API, NFC verification engine, and Google Wallet integration service for **Regulr**, an app-less digital loyalty card platform for independent shops and cafés.

## Quick Reference Commands

- `npm run dev` - Start the backend in watch mode on port 3001 (`tsx watch src/server.ts`)
- `npm run typecheck` - Run TypeScript compiler checks (`tsc --noEmit`)
- `npm test` - Run all unit tests (NFC AES-CMAC crypto, Wallet passes, Promotions logic)
- `npm run build` - TypeScript compilation check
- `npm run build:api` - Bundle `src/app.ts` with esbuild for Vercel serverless deployment
- `npm run db:migrate` - Run Prisma migrations locally (`prisma migrate dev`)
- `npx prisma studio` - Open database GUI in browser
- `npm run tag:key -- <UID>` - Derive NTAG 424 DNA encryption keys for a physical NFC card

## Architecture Overview

```
backend/
├── api/index.js          # Vercel serverless entrypoint (loads bundled server-dist/app.mjs)
├── prisma/
│   ├── schema.prisma     # Postgres schema (Neon Postgres)
│   └── migrations/       # Version-controlled database migrations
├── shared/
│   ├── stampArt.ts       # Shared reward ladder SVG generator & icon catalog
│   └── promotions.ts     # Happy hours and promotion helpers
├── src/
│   ├── app.ts            # Express app, CORS, middleware, and route mounting
│   ├── server.ts         # Long-lived HTTP server for local dev (port 3001)
│   ├── config.ts         # Environment variables validation & parsing
│   ├── auth.ts           # Google OAuth 2.0 verification & dev login session cookies
│   ├── db.ts             # Prisma client singleton
│   ├── errors.ts         # Centralized error handler and validation formatting
│   ├── loyalty.ts        # Core business rules: join, stamp, redeem, activity log
│   ├── messages.ts       # Merchant-to-customer broadcast messaging & delivery
│   ├── rewards.ts        # Reward catalog queries & cooldown checks
│   ├── stores.ts         # Store profile validation & operating hours parsing
│   ├── uploads.ts        # Vercel Blob storage (or local uploads/ fallback)
│   ├── nfc/              # NFC tap verification (Basic secret or NTAG 424 DNA SUN)
│   │   ├── sun.ts        # AES-128 CMAC and AES-CBC decryption for NTAG 424 DNA
│   │   └── verify.ts     # Tap verification logic and session creation
│   ├── wallet/           # Digital wallet providers
│   │   ├── google.ts     # Google Wallet API client, LoyaltyClass & LoyaltyObject
│   │   ├── art.ts        # Dynamic pass banner image generator (SVG to PNG via Resvg)
│   │   └── passContent.ts# Pass details (reward menu, happy hours, links, geofencing)
│   └── routes/           # Express routers
│       ├── customer.ts   # /api/cards, /api/s/:slug, /api/discover, /api/account
│       ├── portal.ts     # /api/portal/* (merchant dashboard, rewards, tags, customers)
│       ├── promotions.ts # /api/portal/promotions (happy hours, bonuses)
│       ├── messages.ts   # /api/portal/messages (customer push broadcasts)
│       └── tap.ts        # /t/:slug (physical NFC tap landing endpoint)
└── test/                 # Test suites (Node test runner + tsx)
```

## Core Business Rules & Anti-Cheat

1. **Tap Session Window:**
   - Physical NFC taps hit `/t/:store?picc=...&cmac=...`.
   - Verified taps create a `TapSession` valid for **5 minutes**.
   - Customers can only redeem rewards during an active tap session, proving physical presence at the counter.

2. **Stamp Cooldowns:**
   - Default cooldown between stamps is 120 minutes per store (configurable in store profile).

3. **NTAG 424 DNA Cryptography (SUN):**
   - Each tap produces a cryptographically signed one-time URL with encrypted PICC data and CMAC.
   - Replaying an old NFC tap URL is cryptographically impossible because counter values are strictly incremental.

4. **Google Wallet Real-Time Sync:**
   - Passes are updated via PATCH requests to Google's REST API whenever stamps change or rewards are redeemed.
   - Background tasks use `@vercel/functions` `waitUntil()` so API responses return immediately without waiting on Google.

## Deployment Settings (Vercel)

- **Framework:** Other
- **Build Command:** `npm run vercel-build`
- **Output Directory:** Default
- **Environment Variables:**
  - `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (Neon Postgres)
  - `SESSION_SECRET`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_WALLET_ISSUER_ID`
  - `GOOGLE_WALLET_KEY_JSON`
  - `PUBLIC_URL` (Backend Vercel URL)
  - `FRONTEND_URL` (Frontend Vercel URL)
