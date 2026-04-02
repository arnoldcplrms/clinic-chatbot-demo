# AI Chatbot Backend

A production-ready AI chatbot backend built with **Bun.js**, **Fastify**, and **TypeScript**. It integrates Google Gemini 2.5 Flash (via the OpenAI-compatible endpoint) with Google Calendar for intelligent booking automation, and connects to Facebook Messenger for end-user messaging.

## Stack

| Layer      | Technology                               |
| ---------- | ---------------------------------------- |
| Runtime    | Bun.js                                   |
| Framework  | Fastify 4 + TypeScript (strict)          |
| AI         | Google Gemini 2.5 Flash via `openai` SDK |
| Calendar   | Google Calendar API v3 (`googleapis`)    |
| Validation | Zod                                      |
| Env        | `@t3-oss/env-core`                       |

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh) >= 1.1
- A [Google AI Studio](https://aistudio.google.com) API key
- A Google Cloud project with the Calendar API enabled and OAuth2 credentials
- A Facebook Developer App with Messenger channel _(optional — only needed for Messenger integration)_

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in all values. See the table below for descriptions.

### 4. Run the Development Server

```bash
bun run dev
```

The server starts on `http://localhost:3000` (or the port set in `PORT`).

### 5. Verify It Is Running

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-03-30T00:00:00.000Z"}
```

---

## Environment Variables

| Variable               | Required | Default                                                    | Description                                     |
| ---------------------- | -------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `PORT`                 | No       | `3000`                                                     | HTTP listen port                                |
| `NODE_ENV`             | No       | `development`                                              | `development`, `production`, or `test`          |
| `GEMINI_API_KEY`       | Yes      | —                                                          | Google AI Studio API key                        |
| `GEMINI_BASE_URL`      | No       | `https://generativelanguage.googleapis.com/v1beta/openai/` | Gemini OpenAI-compatible base URL               |
| `GEMINI_MODEL`         | No       | `gemini-2.5-flash`                                         | Model identifier                                |
| `GOOGLE_CLIENT_ID`     | Yes      | —                                                          | Google OAuth2 client ID                         |
| `GOOGLE_CLIENT_SECRET` | Yes      | —                                                          | Google OAuth2 client secret                     |
| `GOOGLE_REDIRECT_URI`  | Yes      | —                                                          | OAuth2 redirect URI                             |
| `GOOGLE_REFRESH_TOKEN` | No       | —                                                          | Long-lived Calendar refresh token after OAuth   |
| `GOOGLE_CALENDAR_ID`   | No       | `primary`                                                  | Target Google Calendar                          |
| `FB_VERIFY_TOKEN`      | Yes      | —                                                          | Secret token for Facebook webhook verification  |
| `FB_PAGE_ACCESS_TOKEN` | Yes      | —                                                          | Facebook Page access token for sending messages |

### Obtaining a Google OAuth2 Refresh Token

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create an **OAuth 2.0 Client ID** (application type: **Web application**).
2. Add your callback URL to the OAuth client, for example `http://localhost:3000/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in your `.env`.
4. Start the server and open `GET /api/auth/google` to get the Google consent URL.
5. Sign in and approve the Calendar scope.
6. Google redirects back to `/api/auth/google/callback`, which exchanges the code and shows the `GOOGLE_REFRESH_TOKEN` value you should save in `.env`.
7. Restart the server after saving the refresh token.

---

## Configuring Business Rules

Edit `src/config/business-rules.config.ts` to define your business constraints at startup:

```ts
export let businessRules: BusinessRules = {
  timezone: 'America/New_York',
  businessHours: {
    monday: { start: '09:00', end: '17:00' },
    tuesday: { start: '09:00', end: '17:00' },
    wednesday: { start: '09:00', end: '17:00' },
    thursday: { start: '09:00', end: '17:00' },
    friday: { start: '09:00', end: '17:00' },
    saturday: null, // Closed
    sunday: null, // Closed
  },
  defaultBookingDuration: 60, // minutes
  bufferMinutes: 15,
  blackoutDates: ['2026-12-25', '2027-01-01'],
  maxBookingsPerDay: 8,
  services: [
    {
      id: 'consult',
      name: 'Consultation',
      duration: 60,
      description: 'One-hour general consultation',
    },
    {
      id: 'followup',
      name: 'Follow-up',
      duration: 30,
      description: '30-minute follow-up appointment',
    },
  ],
};
```

Rules are injected into the AI system prompt automatically on every chat turn, so changes to this file take effect after a server restart.

### Updating Rules at Runtime

You can update rules without restarting the server via the config API:

```bash
curl -X POST http://localhost:3000/api/config/business-rules \
  -H "Content-Type: application/json" \
  -d '{"maxBookingsPerDay": 10, "bufferMinutes": 30}'
```

---

## API Reference

| Method   | Path                         | Body / Query                                    | Description                      |
| -------- | ---------------------------- | ----------------------------------------------- | -------------------------------- |
| `GET`    | `/health`                    | —                                               | Liveness check                   |
| `POST`   | `/api/chat`                  | `{ sessionId, message }`                        | Chat with the AI assistant       |
| `GET`    | `/webhook`                   | `hub.mode`, `hub.verify_token`, `hub.challenge` | Facebook webhook verification    |
| `POST`   | `/webhook`                   | Facebook webhook payload                        | Incoming Messenger events        |
| `GET`    | `/api/events`                | `?from=ISO&to=ISO`                              | List calendar events             |
| `POST`   | `/api/events`                | `{ title, startDateTime, endDateTime, … }`      | Create a calendar event          |
| `PATCH`  | `/api/events/:id`            | Partial event fields                            | Update a calendar event          |
| `DELETE` | `/api/events/:id`            | —                                               | Delete a calendar event          |
| `GET`    | `/api/config/business-rules` | —                                               | Get current business rules       |
| `POST`   | `/api/config/business-rules` | Partial `BusinessRules` object                  | Update business rules at runtime |
| `GET`    | `/api/auth/google`           | `?state=optional`                               | Create Google OAuth consent URL  |
| `GET`    | `/api/auth/google/callback`  | `?code=...`                                     | Exchange auth code for tokens    |

### Example: Chat (testing outside Messenger)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "user-123", "message": "Book me a consultation next Monday at 10am"}'
```

---

## Facebook Messenger Setup

1. Create a Facebook App and add the **Messenger** product.
2. Link a Facebook Page to the app and generate a **Page Access Token** → set `FB_PAGE_ACCESS_TOKEN`.
3. Choose any secret string for `FB_VERIFY_TOKEN`.
4. Deploy this server publicly (e.g. via ngrok for local testing).
5. In the Facebook Developer Console, configure the webhook URL as `https://your-domain.com/webhook` and subscribe to **messages** and **messaging_postbacks** fields. Facebook will call `GET /webhook` with your verify token to confirm.

---

## Scripts

```bash
bun run dev       # Start with file watching (hot reload)
bun run build     # Bundle to dist/
bun run start     # Run the built bundle (production)
bun run typecheck # TypeScript type check without emitting
```
