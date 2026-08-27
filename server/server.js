import 'dotenv/config';
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
  res.json({ ok: true, model: GEMINI_MODEL, search: GEMINI_SEARCH, keyConfigured: Boolean(GEMINI_API_KEY) });
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

  const callGemini = (useSearch) =>
    fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
  console.log(`HobbyGenie server on http://localhost:${PORT} (model: ${GEMINI_MODEL}, search: ${GEMINI_SEARCH}, key: ${GEMINI_API_KEY ? 'set' : 'MISSING'})`);
});
