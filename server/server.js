import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Google Search grounding needs a paid plan — off by default. Set GEMINI_SEARCH=true to try it.
const GEMINI_SEARCH = process.env.GEMINI_SEARCH === 'true';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// --- Google OAuth / Calendar config -----------------------------------------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Where the browser lands after login. In dev the CRA proxy (client/src/setupProxy.js)
// forwards /api to this server, so the redirect URI lives on the client origin.
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI || `${CLIENT_URL}/api/auth/google/callback`;
const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

// In-memory session store — fine for a demo, swap for Redis/DB in production.
const sessions = new Map(); // sid -> { tokens: {...}, profile: {...} }
const pendingStates = new Map(); // state -> expiry (ms)

const parseCookies = (req) => {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

const getSession = (req) => {
  const sid = parseCookies(req).hg_sid;
  return sid ? sessions.get(sid) : undefined;
};

// Exchange an auth code (or refresh token) for tokens.
const fetchToken = async (params) => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      ...params,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'token request failed');
  return data;
};

// Return a valid access token for a session, refreshing if it has expired.
const getAccessToken = async (session) => {
  const t = session.tokens;
  if (t.access_token && t.expiry_date && Date.now() < t.expiry_date - 60_000) {
    return t.access_token;
  }
  if (!t.refresh_token) throw new Error('session expired — reconnect Google Calendar');
  const refreshed = await fetchToken({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  });
  session.tokens = {
    ...t,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
  };
  return session.tokens.access_token;
};

// --- OAuth routes -----------------------------------------------------------
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Google OAuth is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in server/.env');
  }
  const state = crypto.randomUUID();
  pendingStates.set(state, Date.now() + 10 * 60_000);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${CLIENT_URL}/?calendar=denied`);

  const expiry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiry || Date.now() > expiry) {
    return res.redirect(`${CLIENT_URL}/?calendar=error`);
  }

  try {
    const tokens = await fetchToken({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: OAUTH_REDIRECT_URI,
    });

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    const sid = crypto.randomUUID();
    sessions.set(sid, {
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: Date.now() + tokens.expires_in * 1000,
      },
      profile: { email: profile.email, name: profile.name, picture: profile.picture },
    });

    res.setHeader(
      'Set-Cookie',
      `hg_sid=${sid}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`
    );
    res.redirect(`${CLIENT_URL}/?calendar=connected`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`${CLIENT_URL}/?calendar=error`);
  }
});

app.get('/api/auth/status', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ connected: false });
  res.json({ connected: true, profile: session.profile });
});

app.post('/api/auth/logout', (req, res) => {
  const sid = parseCookies(req).hg_sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'hg_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

// --- Calendar free/busy ----------------------------------------------------
// Turn Google's busy intervals into free windows inside working hours.
const buildFreeSlots = (busy, days) => {
  const DAY_START = 8; // 8am
  const DAY_END = 22; // 10pm
  const slots = [];
  const now = new Date();
  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    let cursor = new Date(day);
    cursor.setHours(DAY_START, 0, 0, 0);
    if (d === 0 && cursor < now) cursor = new Date(Math.ceil(now.getTime() / 1800_000) * 1800_000);
    const dayEnd = new Date(day);
    dayEnd.setHours(DAY_END, 0, 0, 0);

    const dayBusy = busy
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
      .filter((b) => b.end > cursor && b.start < dayEnd)
      .sort((a, b) => a.start - b.start);

    for (const b of dayBusy) {
      if (b.start > cursor) slots.push({ start: cursor.toISOString(), end: new Date(Math.min(b.start, dayEnd)).toISOString() });
      if (b.end > cursor) cursor = new Date(b.end);
      if (cursor >= dayEnd) break;
    }
    if (cursor < dayEnd) slots.push({ start: cursor.toISOString(), end: dayEnd.toISOString() });
  }
  return slots.filter((s) => new Date(s.end) - new Date(s.start) >= 30 * 60_000);
};

const summarizeFreeSlots = (slots) => {
  const fmt = (iso) =>
    new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const byDay = new Map();
  for (const s of slots) {
    const key = new Date(s.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(
      `${new Date(s.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}–${new Date(
        s.end
      ).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    );
  }
  return [...byDay.entries()].map(([day, ranges]) => `${day}: ${ranges.join(', ')}`).join('\n');
};

app.get('/api/calendar/freebusy', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not connected to Google Calendar.' });

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

  try {
    const accessToken = await getAccessToken(session);
    const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
    });
    const data = await fbRes.json();
    if (!fbRes.ok) {
      return res.status(502).json({ error: data.error?.message || 'Calendar request failed.' });
    }

    const busy = data.calendars?.primary?.busy || [];
    const freeSlots = buildFreeSlots(busy, days);
    res.json({
      timeMin,
      timeMax,
      busy,
      freeSlots,
      summary: summarizeFreeSlots(freeSlots),
    });
  } catch (err) {
    console.error('freeBusy error:', err);
    res.status(500).json({ error: err.message || 'Failed to read calendar.' });
  }
});

const SYSTEM_PROMPT = `You are HobbyGenie, a friendly conversational assistant that recommends local
hobbies, classes, and events based on a user's location and availability.

Guidelines:
- If you don't know the user's zip code / city yet, ask for it before recommending places.
- Ask one light clarifying question at a time (preferences, budget, indoor/outdoor, time of day).
- When recommending, name real, well-known venues near the user. Include the place name,
  neighborhood/area, and why it fits.
- Give 3-5 concrete options, not a wall of text. Use short bullet points.
- If the user shares free time slots, tailor suggestions to those windows.
- Keep replies conversational and concise. Lead with the answer, not a preamble.`;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    search: GEMINI_SEARCH,
    keyConfigured: Boolean(GEMINI_API_KEY),
    googleOAuthConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
});

app.post('/api/chat', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set. Copy server/.env.example to server/.env and add your key.' });
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const contents = messages
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({
      role: m.sender === 'bot' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

  if (contents.length === 0) {
    return res.status(400).json({ error: 'No messages provided.' });
  }

  // Optional calendar availability context from the client.
  const availability = typeof req.body?.availability === 'string' ? req.body.availability.trim() : '';
  const systemText = availability
    ? `${SYSTEM_PROMPT}\n\nThe user has shared their Google Calendar. Their free windows over the coming days are:\n${availability}\nPrefer suggestions that fit these windows and reference the day/time when relevant.`
    : SYSTEM_PROMPT;

  const callGemini = (useSearch) =>
    fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents,
        ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          // gemini-3.x is a reasoning model; keep thinking short so it doesn't
          // spend the whole budget on thoughts and return an empty answer.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    let gRes = await callGemini(GEMINI_SEARCH);
    let data = await gRes.json();

    // Grounding needs a paid plan; if it's quota-blocked, fall back to a plain call.
    if (!gRes.ok && GEMINI_SEARCH && gRes.status === 429) {
      console.warn('Search grounding hit quota (429) — retrying without it.');
      gRes = await callGemini(false);
      data = await gRes.json();
    }

    // Free tier is ~5 requests/min. Back off and retry a couple of times.
    for (let attempt = 1; attempt <= 2 && gRes.status === 429; attempt++) {
      const wait = attempt * 3000;
      console.warn(`Rate limited (429) — retrying in ${wait}ms (attempt ${attempt}/2).`);
      await sleep(wait);
      gRes = await callGemini(false);
      data = await gRes.json();
    }

    if (gRes.status === 429) {
      return res.status(429).json({
        error: "HobbyGenie is a bit popular right now and hit its rate limit. Give it about a minute, then try again.",
      });
    }

    if (!gRes.ok) {
      const message = data?.error?.message || `Gemini request failed (${gRes.status})`;
      return res.status(502).json({ error: message });
    }

    const extractText = (d) =>
      (d?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join('')
        .trim();

    let text = extractText(data);

    // Reasoning models occasionally spend the whole budget thinking and return
    // no answer (finishReason MAX_TOKENS). Retry once before giving up.
    if (!text && data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      console.warn('Empty answer (MAX_TOKENS) — retrying once.');
      const retry = await callGemini(false);
      if (retry.ok) text = extractText(await retry.json());
    }

    const sources = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web && { title: c.web.title, uri: c.web.uri })
      .filter(Boolean);

    if (!text) {
      return res.status(502).json({
        error: 'HobbyGenie got a little tongue-tied. Try asking again.',
      });
    }

    res.json({ text, sources });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to reach Gemini.' });
  }
});

app.listen(PORT, () => {
  console.log(`HobbyGenie server on http://localhost:${PORT} (model: ${GEMINI_MODEL}, search: ${GEMINI_SEARCH}, key: ${GEMINI_API_KEY ? 'set' : 'MISSING'}, google oauth: ${GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? 'set' : 'MISSING'})`);
});
