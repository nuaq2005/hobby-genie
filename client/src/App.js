import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import Markdown from './Markdown';

const GREETING = {
  id: 1,
  sender: 'bot',
  text: 'Hi there! I am HobbyGenie. Tell me your zip code or what kind of activities you are in the mood for!',
};

function App() {
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const [calendar, setCalendar] = useState({
    connected: false,
    profile: null,
    loading: true,
  });
  const [availability, setAvailability] = useState(null); // { summary, freeSlots }
  const [calError, setCalError] = useState('');

  const loadFreeBusy = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/freebusy?days=7');
      const data = await res.json();
      if (res.ok) {
        setAvailability({ summary: data.summary, freeSlots: data.freeSlots || [] });
        setCalError('');
      } else {
        setCalError(data.error || 'Could not read your calendar.');
      }
    } catch {
      setCalError('Could not reach the server for calendar data.');
    }
  }, []);

  // Check auth state on load, and surface the ?calendar= result from the OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('calendar');
    if (outcome) {
      window.history.replaceState({}, '', window.location.pathname);
      if (outcome === 'denied') setCalError('Calendar access was declined.');
      if (outcome === 'error') setCalError('Something went wrong connecting your calendar.');
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        setCalendar({ connected: !!data.connected, profile: data.profile || null, loading: false });
        if (data.connected) loadFreeBusy();
      } catch {
        setCalendar({ connected: false, profile: null, loading: false });
      }
    })();
  }, [loadFreeBusy]);

  const connectCalendar = () => {
    window.location.href = '/api/auth/google';
  };

  const disconnectCalendar = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setCalendar({ connected: false, profile: null, loading: false });
    setAvailability(null);
    setCalError('');
  };

  const askGenie = async (history) => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ sender, text }) => ({ sender, text })),
          availability: availability?.summary || undefined,
        }),
      });
      const data = await res.json();

      const botMsg = res.ok
        ? { id: Date.now() + 1, sender: 'bot', text: data.text, sources: data.sources || [] }
        : { id: Date.now() + 1, sender: 'bot', text: `⚠️ ${data.error || 'Something went wrong.'}` };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: '⚠️ Could not reach the server. Is it running on port 4000?' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = { id: Date.now(), sender: 'user', text: input.trim() };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    askGenie(history);
  };

  const handleSurpriseMe = () => {
    if (loading) return;
    const userMsg = {
      id: Date.now(),
      sender: 'user',
      text: 'Surprise me! Suggest a fun local activity I might not think of.',
    };
    const history = [...messages, userMsg];
    setMessages(history);
    askGenie(history);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <h2 className="brand">
          <img src="/genie-lamp.png" alt="HobbyGenie lamp" />
          HobbyGenie
        </h2>
        <div className="header-actions">
          {calendar.loading ? null : calendar.connected ? (
            <div className="calendar-connected">
              <span className="calendar-status">
                📅 {calendar.profile?.email || 'Calendar connected'}
              </span>
              <button className="calendar-btn ghost" onClick={disconnectCalendar}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="calendar-btn" onClick={connectCalendar}>
              📅 Share Google Calendar
            </button>
          )}
        </div>
      </header>

      {calError && <div className="calendar-error">⚠️ {calError}</div>}

      {calendar.connected && availability && (
        <div className="availability-panel">
          <span className="availability-label">Your free windows (next 7 days)</span>
          {availability.freeSlots.length === 0 ? (
            <p>No open windows found — you look booked solid!</p>
          ) : (
            <pre className="availability-summary">{availability.summary}</pre>
          )}
        </div>
      )}

      {/* Message History */}
      <div className="message-list">
        {messages.map((msg) => (
          <div key={msg.id} className={`message-bubble ${msg.sender}`}>
            <span className="sender-name">{msg.sender === 'bot' ? 'HobbyGenie' : 'You'}</span>
            {msg.sender === 'bot' ? <Markdown text={msg.text} /> : <p>{msg.text}</p>}
            {msg.sources && msg.sources.length > 0 && (
              <div className="sources">
                <span className="sources-label">Sources</span>
                <ul>
                  {msg.sources.map((s, i) => (
                    <li key={i}>
                      <a href={s.uri} target="_blank" rel="noreferrer">
                        {s.title || s.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="message-bubble bot">
            <span className="sender-name">HobbyGenie</span>
            <p>Thinking…</p>
          </div>
        )}
      </div>

      {/* Actions & Input Bar */}
      <footer className="chat-footer">
        <button type="button" className="surprise-btn" onClick={handleSurpriseMe} disabled={loading}>
          ✨ Surprise Me!
        </button>
        <form onSubmit={handleSend} className="input-form">
          <input
            type="text"
            placeholder="Type a message or enter your zip code..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="send-btn" disabled={loading}>
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}

export default App;
