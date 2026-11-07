# Regulr Backend

The API, NFC cryptographic verification, and Google Wallet integration microservice for **Regulr** — an app-less digital loyalty card platform for independent shops and cafés.

---

## 🛠 Tech Stack
- **Runtime:** Node.js 20+ (ES Modules)
- **Framework:** Express 5
- **Database:** PostgreSQL (Neon Postgres) via Prisma ORM
- **Authentication:** Google OAuth 2.0 & Session Cookies (with instant local dev bypass)
- **Wallet Provider:** Google Wallet REST API & JWT Passes
- **NFC Engine:** AES-CMAC NTAG 424 DNA Secure Dynamic Messaging (SUN)

---

## 🚀 Getting Started Locally

Follow these steps to run the backend on your machine in under 2 minutes:

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v20 or higher
- [Git](https://git-scm.com/)

### 2. Install Dependencies
```bash
git clone https://github.com/regulr-dev/backend.git
cd backend
npm install
```

### 3. Environment Configuration
Create a `.env` file from the example:
```bash
cp .env.example .env
```
Fill in the following values in `.env`:
```env
# Database (Neon Postgres connection strings)
DATABASE_URL="postgresql://...-pooler...neon.tech/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://...neon.tech/neondb?sslmode=require"

# Server Settings
PORT=3001
PUBLIC_URL="http://localhost:3001"
SESSION_SECRET="any-long-random-string-for-local-dev"

# Instant Dev Login (Allows any developer to sign in with any email without Google OAuth)
DEV_LOGIN="true"

# Google OAuth & Wallet (Optional for basic local testing, required for real Wallet passes)
GOOGLE_CLIENT_ID=""
GOOGLE_WALLET_ISSUER_ID=""
GOOGLE_WALLET_KEY_JSON=""
```

### 4. Run Database Migrations
Make sure your local schema is in sync with the database:
```bash
npx prisma migrate deploy
```

### 5. Start the Development Server
```bash
npm run dev
```
The backend API is now running with hot reload on **`http://localhost:3001`**.

---

## 🧪 Testing Your Changes Locally (Before Pushing)

Always run these two checks before committing or opening a Pull Request:

### 1. TypeScript Verification
Make sure there are zero compiler or type errors:
```bash
npm run typecheck
```

### 2. Automated Unit Tests
Runs the test suite for NFC cryptographic verification, Google Wallet pass generation, and happy hour promotion logic:
```bash
npm test
```
*All tests should pass before opening a PR.*

### 3. Database GUI (Prisma Studio)
To inspect or edit database rows locally in your browser:
```bash
npx prisma studio
```

---

## 🔑 Developer Authentication & Google Wallet Testing

### Local Dev Sign-In (`DEV_LOGIN="true"`)
When `DEV_LOGIN="true"` is set in `.env`:
- Developers **do not need Google OAuth credentials**.
- On the frontend sign-in modal, a "Dev Login" email box appears.
- Developers can type any email (e.g. `alice@cafe.com` or `dev@regulr.app`) and immediately log in as a store owner or customer.

### Testing Real Google OAuth Sign-In
If testing real Google Sign-In while the app is in testing mode:
1. The project admin must go to [Google Cloud Console → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).
2. Under **Test users**, click **+ ADD USERS** and add the developer's `@gmail.com` address.

### Testing Real Google Wallet Passes (Demo Mode)
While the Google Wallet Issuer account is in **Demo Mode**, only approved test accounts can save passes:
1. The project admin must go to the [Google Pay & Wallet Console](https://pay.google.com/business/console).
2. Go to **Users / Test Accounts** and add the developer's Google account email.

---

## 🌿 Git & Pull Request Workflow

We follow the same collaboration standard used by professional teams:

1. **Branch off `main`:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature-name
   # or: git checkout -b fix/bug-description
   ```
2. **Make your changes & test locally:**
   ```bash
   npm run typecheck
   npm test
   ```
3. **Commit with clear messages:**
   ```bash
   git add .
   git commit -m "feat(rewards): add maximum redemption limit validation"
   ```
4. **Push to GitHub and open a Pull Request:**
   ```bash
   git push -u origin feat/your-feature-name
   ```
5. **Automated CI:** GitHub Actions runs `npm run typecheck` and `npm test` automatically on your PR.
6. Once reviewed and approved, merge into `main` (which automatically deploys to production).
