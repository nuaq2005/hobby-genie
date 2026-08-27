# HobbySync 🗓️🎯
*(working title — swap in your actual project name)*

Find something to do, when you're actually free to do it — and bring your friends along.

HobbySync is a conversational assistant that looks at your real calendar availability and your location to recommend local hobbies and events, then helps you turn a plan into a group activity by inviting friends with a single link.

---

## Devpost Submission

### What we built
HobbySync is a chat-first web app that removes the friction between "I have free time" and "I actually did something with it." Instead of separately checking your calendar, googling activities near you, and texting a group chat to coordinate, HobbySync does all three in one conversation:

1. You sign in with Google.
2. You land directly in a chat interface — no dashboards, no forms to hunt through.
3. You share your Google Calendar (or just tell the bot when you're free).
4. You give a zip code and, optionally, a few preferences.
5. The assistant cross-references your open time slots with nearby events and hobbies and returns a filterable list.
6. If you want company, you generate a shareable invite link so friends can join the plan and it becomes a group activity.

### How it functions
- **Auth**: Google OAuth login gives us identity plus (with consent) calendar read access — no separate account system to build or maintain.
- **Conversational interface**: A chat UI is the front door for the whole experience. The assistant asks clarifying questions ("Any other preferences?") only when they'd meaningfully narrow the search, and gracefully falls back to sensible defaults (popular local activities) if the user doesn't answer — the app never stalls waiting on input.
- **Availability**: If the user grants calendar access, we pull free/busy blocks from the Google Calendar API and render them on-page. If that integration isn't ready in time, the assistant simply asks the user for their availability in natural language and reasons over the answer — same downstream result, lower-effort input path.
- **Discovery**: Zip code + preferences are sent to the Google Maps/Places API to source nearby venues and events, which get merged with the user's free time windows into a ranked, filterable list (distance, category, time of day).
- **Group activities**: A user can generate an invite link for a specific plan. Friends who open it can add the event to their own calendar and (in a stretch version) contribute their own availability, so the app can suggest a time that works for the whole group rather than just the organizer.

### Impact
Calendars are full of small, unclaimed pockets of free time that quietly go to waste because finding something worth doing in them takes more effort than it's worth. HobbySync collapses that decision cost to a single conversation, and by making it trivially easy to loop friends in, it nudges solo "I guess I'll scroll my phone" gaps into shared, in-person experiences — which is where most of the actual value (and memories) come from.

---

## Architecture

```mermaid
flowchart TD
    U[User] -->|Google OAuth login| FE[Chat Web App]
    FE <--> BE[Backend / Chat Orchestrator API]

    BE -->|OAuth token| GCal[Google Calendar API]
    GCal -->|Free/busy + events| BE

    BE -->|zip code + preferences| Maps[Google Maps / Places API]
    Maps -->|Nearby venues & events| BE

    BE -->|conversation turns| LLM[Chatbot / LLM Layer]
    LLM -->|clarifying questions,<br/>preference extraction| BE

    BE -->|ranked, filterable events| FE
    FE -->|generate invite link| Share[Shareable Group Link]
    Share -->|friend opens link| Friend[Friend's Browser]
    Friend -->|joins plan / adds availability| BE
    BE -->|group-aware time & event suggestions| FE
```

**Request flow, in short:** the frontend never talks to Google APIs directly — every external call is proxied through the backend so OAuth tokens stay server-side. The chatbot layer is stateless per turn; conversation state (calendar data, zip code, preferences collected so far) is passed back in on each call so any step can be re-entered without losing context.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React (chat UI) | Single conversational interface, renders calendar + results inline |
| Auth | Google OAuth 2.0 | Gmail login, calendar consent scope |
| Backend | Node.js / Express (or Python / FastAPI) | Orchestrates calendar, maps, and chatbot calls; holds tokens |
| Calendar data | Google Calendar API | Free/busy lookup, event creation for group plans |
| Location/events | Google Maps / Places API | Nearby venues, categories, geocoding from zip code |
| Conversational AI | LLM (e.g. Claude/GPT via API) | Preference elicitation, natural-language availability parsing, ranking rationale |
| Sharing | Signed short-lived invite links | Friend join flow for group activities |
| Hosting | Vercel / Render / Firebase (pick one) | Deployment for demo |

---

## Setup & Run Instructions

### Prerequisites
- Node.js 18+ and npm (or Python 3.10+ if using a Python backend)
- A Google Cloud project with the **Calendar API** and **Places/Maps API** enabled
- OAuth 2.0 credentials (Client ID/Secret) with the `calendar.readonly` scope authorized
- An API key for your chosen LLM provider

### 1. Clone and install
```bash
git clone <your-repo-url>
cd hobbysync
npm install        # installs both frontend and backend deps if using a monorepo
```

### 2. Configure environment variables
Create a `.env` file in the backend directory:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
GOOGLE_MAPS_API_KEY=your_maps_key
LLM_API_KEY=your_llm_provider_key
SESSION_SECRET=some_random_string
```

### 3. Run the backend
```bash
cd server
npm run dev        # starts API on http://localhost:4000
```

### 4. Run the frontend
```bash
cd client
npm start           # starts chat UI on http://localhost:3000
```

### 5. Try it out
1. Open `http://localhost:3000`.
2. Sign in with Google.
3. Click "Share Calendar" (or just tell the chatbot when you're free).
4. Enter a zip code when asked.
5. Answer (or skip) the preference question.
6. Browse and filter the suggested activities, and generate an invite link to turn one into a group plan.

---

## Key Design Decisions

- **Chat-first, not dashboard-first**: A conversational interface lets the app ask only for the information it actually needs, in the order it needs it, instead of front-loading a form. This also makes the "no calendar access yet" fallback (asking for availability directly) a natural extension of the same interface rather than a separate mode.
- **Graceful degradation on calendar sharing**: Calendar-button integration (rendering the calendar on-page) is treated as an enhancement, not a dependency — the core flow (chatbot asks/infers availability) works with or without it, so the feature can be descoped under time pressure without breaking the demo.
- **Default to popular activities on non-response**: Rather than blocking on a preference question, the assistant times out to a sensible default. This keeps the funnel moving for users who just want quick suggestions, while still supporting personalization for users who engage.
- **Backend-mediated API calls**: All Google Calendar/Maps calls are proxied through the backend so OAuth tokens and API keys never reach the client — important given the app is requesting calendar access.
- **Shareable link over account-to-account "friending"**: Group coordination is scoped to a single link per plan rather than a full social graph, which is dramatically simpler to build in a hackathon timeframe while still delivering the core "do this together" value.
