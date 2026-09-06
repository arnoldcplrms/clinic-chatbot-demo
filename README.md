# AI Chatbot Backend

A production-ready AI chatbot backend built with **Bun.js**, **Fastify**, and **TypeScript**. It integrates a pluggable AI provider (OpenCode Go, Gemini, Groq — all OpenAI-compatible) with Google Calendar for intelligent booking automation, and connects to Facebook Messenger for end-user messaging.

## Stack

| Layer      | Technology                               |
| ---------- | ---------------------------------------- |
| Runtime    | Bun.js                                   |
| Framework  | Fastify 4 + TypeScript (strict)          |
| AI         | Pluggable OpenAI-compatible provider (`AI_PROVIDER` env) |
| Calendar   | Google Calendar API v3 (`googleapis`)    |
| Validation | Zod                                      |
| Env        | `@t3-oss/env-core`                       |

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh) >= 1.1
- An API key for an AI provider (default: [OpenCode Go](https://opencode.ai/docs/go/))
- A Google Cloud project with the Calendar API enabled and a service account key
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
| `AI_PROVIDER`          | No       | `opencode`                                                 | Active provider: `opencode`, `gemini`, or `groq` |
| `OPENCODE_API_KEY`     | *        | —                                                          | OpenCode Go API key (required when `AI_PROVIDER=opencode`) |
| `OPENCODE_BASE_URL`    | No       | `https://opencode.ai/zen/go/v1`                            | OpenCode Go OpenAI-compatible base URL          |
| `OPENCODE_MODEL`       | No       | `mimo-v2.5`                                                | OpenCode Go model identifier                    |
| `GEMINI_API_KEY`       | *        | —                                                          | Google AI Studio API key (required when `AI_PROVIDER=gemini`) |
| `GEMINI_BASE_URL`      | No       | `https://generativelanguage.googleapis.com/v1beta/openai/` | Gemini OpenAI-compatible base URL               |
| `GEMINI_MODEL`         | No       | `gemini-2.5-flash`                                         | Model identifier                                |
| `GROQ_API_KEY`         | *        | —                                                          | Groq API key (required when `AI_PROVIDER=groq`) |
| `GROQ_BASE_URL`        | No       | `https://api.groq.com/openai/v1`                           | Groq OpenAI-compatible base URL                 |
| `GROQ_MODEL`           | No       | `llama-3.3-70b-versatile`                                  | Model identifier                                |
| `GOOGLE_SERVICE_ACCOUNT` | Yes    | —                                                          | One-line service account key JSON               |
| `GOOGLE_CALENDAR_ID`   | No       | `primary`                                                  | Target Google Calendar                          |
| `FB_VERIFY_TOKEN`      | Yes      | —                                                          | Secret token for Facebook webhook verification  |
| `FB_PAGE_ACCESS_TOKEN` | Yes      | —                                                          | Facebook Page access token for sending messages |

> `*` Only the key for the provider selected by `AI_PROVIDER` is required.

### Setting up Google Calendar (service account)

1. In [Google Cloud Console](https://console.cloud.google.com), enable the **Google Calendar API** for your project.
2. Create a **service account** and download its JSON key.
3. Flatten the JSON to one line and put it in `.env`:
   ```bash
   echo "GOOGLE_SERVICE_ACCOUNT=$(jq -c . path/to-key.json)" >> .env
   ```
4. Grant the calendar access: share your Google Calendar with the service account's
   `client_email` (as **Make changes to events**), and set `GOOGLE_CALENDAR_ID` to your
   calendar address — or keep `primary` to book on the service account's own calendar.

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
