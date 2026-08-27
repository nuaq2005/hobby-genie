import React, { useState } from 'react';
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

  const askGenie = async (history) => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ sender, text }) => ({ sender, text })),
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
          <button className="calendar-btn" onClick={() => alert('Calendar connection coming soon!')}>
            📅 Share Google Calendar
          </button>
        </div>
      </header>

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
