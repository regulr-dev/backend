# Regulr Backend

The API, NFC cryptographic verification, and Google Wallet microservice for Regulr.

## Tech Stack
- **Runtime:** Node.js 20+ (ES Modules)
- **Framework:** Express 5
- **Database:** PostgreSQL (Neon Postgres) via Prisma ORM
- **Authentication:** Google OAuth 2.0 (`google-auth-library`) & Session Cookies
- **Wallet Provider:** Google Wallet REST API & JWT
- **NFC Engine:** AES-CMAC NTAG 424 DNA Secure Dynamic Messaging (SUN)

## Getting Started Locally

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

The API runs on `http://localhost:3001`.

## Scripts
- `npm run dev` - Start development server with live reload (`tsx watch`)
- `npm run typecheck` - Run TypeScript compiler checks
- `npm test` - Run unit tests (NFC crypto, Wallet engine, Promotions)
- `npm run db:migrate` - Run Prisma database migrations locally
- `npm run tag:key -- <UID>` - Derive NTAG 424 DNA encryption keys

