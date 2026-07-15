# SARA 567 API

Node.js + Express + MySQL backend for `geme` (players) and `provider` (SP/admin).

## Quick start

```bash
cp .env.example .env
# edit MySQL credentials
npm install
npm run migrate
npm run dev
```

Health: `GET http://localhost:4000/health`

## Player auth (OTP)

1. `POST /auth/check-phone` `{ phone }` → `exists` + `next: otp|password`
2. **New user:** `send-otp` (signup) → `verify-otp` → `set-password` → JWT
3. **Returning:** `login-password` (no OTP)
4. **Forgot:** `send-otp` (forgot) → `verify-otp` → `reset-password`

Dev: `OTP_MOCK=true` logs OTP in server console / returns `debugOtp`.  
Production: set `OTP_MOCK=false`, `OTP_SMS_URL`, `OTP_SMS_API_KEY` (API aate hi plug).

## Auth

Protected routes need `Authorization: Bearer <accessToken>`.  
Webhook: `POST /api/v1/wallet/imb/webhook` (HMAC, not JWT).

## Hard latency SLA

Every request aborts at **2000ms** (`API_TIMEOUT_MS`) with HTTP 504.

## Main routes

- Auth: check-phone, send-otp, verify-otp, set-password, login-password, reset-password, login, refresh, logout, me
- Wallet: GET /, ledger, deposit, withdraw, imb/webhook
- Markets: GET /, GET /:id/games
- Bids: POST /, GET /mine
- Chat: threads, messages, mark read, create thread
- Admin: providers CRUD/toggle, users, user detail, withdraw decide
- Media: POST /media (multipart file upload)
