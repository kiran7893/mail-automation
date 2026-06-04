# Mail Automation

Local-first Electron assistant for reviewing Gmail messages, drafting replies with an OpenAI-compatible LLM, and approving Gmail or Google Calendar actions before anything is sent.

## Features

- Gmail OAuth sign-in with local encrypted token storage.
- Inbox refresh from Gmail using a configurable search query.
- Clean email reader that collapses tracking links and hides noisy footer content.
- LLM-powered summaries, reply options, and calendar proposals.
- Human approval workflow for sending replies and creating calendar events.
- Local audit log with export and content-forget controls.
- OpenAI-compatible model support, including OpenRouter.

## Tech Stack

- Electron + electron-vite
- React + TypeScript
- Google APIs for Gmail and Calendar
- SQL.js for local storage
- Vitest for tests

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Fill in `.env`:

```env
APP_NAME=Mail Automation
LOG_LEVEL=info

OPENAI_API_KEY=
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openrouter/owl-alpha

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_GMAIL_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send
GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events

MAIL_POLL_INTERVAL_SECONDS=60
MAIL_GMAIL_QUERY=in:inbox newer_than:14d -category:promotions -category:social
MAX_EMAILS_PER_POLL=10
ACTION_REQUIRE_APPROVAL=true
AUDIT_LOG_RETENTION_DAYS=90
```

Never commit `.env`. It contains live API keys and OAuth secrets.

## Google OAuth

Create a Google Cloud OAuth client for a desktop app:

1. Enable Gmail API and Google Calendar API.
2. Configure Google Auth Platform as External.
3. Add test users while the app is in Testing mode.
4. Create an OAuth Client ID with application type Desktop app.
5. Add the client ID and secret to `.env`.

The app requests:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.events
```

Public production use with Gmail scopes may require Google verification.

## Development

Run the desktop app:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build production assets:

```bash
npm run build
```

Preview the built Electron app:

```bash
npm run preview
```

## Project Structure

```text
src/main       Electron main process, services, Gmail/Calendar/LLM integration
src/preload    Safe IPC bridge exposed to the renderer
src/renderer   React UI, clean email reader, browser demo mock
src/shared     Shared IPC channel and domain types
src/tests      Unit tests
```

## Notes

- Email content, OAuth tokens, actions, and audit records are stored locally.
- Sending email and creating calendar events always go through explicit approval in the UI.
- OpenRouter models are supported through the OpenAI-compatible chat completions API.
