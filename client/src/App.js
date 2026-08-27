import React, { useState } from 'react';
import './App.css';

function App() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'bot',
      text: 'Hi there! I am HobbyGenie. Tell me your zip code or what kind of activities you are in the mood for!',
    },
  ]);
  const [input, setInput] = useState('');

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message
    const userMsg = { id: Date.now(), sender: 'user', text: input };
    setMessages((prev) => [...prev, userMsg]);

    const userText = input;
    setInput('');

    // Simulated Bot Response
    setTimeout(() => {
      const botMsg = {
        id: Date.now() + 1,
        sender: 'bot',
        text: `Got it! Looking for activities around "${userText}"... Any specific preferences or time slots you prefer?`,
      };
      setMessages((prev) => [...prev, botMsg]);
    }, 800);
  };

  const handleSurpriseMe = () => {
    const surpriseMsg = { id: Date.now(), sender: 'user', text: '✨ Surprise Me!' };
    setMessages((prev) => [...prev, surpriseMsg]);

    setTimeout(() => {
      const botMsg = {
        id: Date.now() + 1,
        sender: 'bot',
        text: '🎲 Surprise Pick! How about trying a local Pottery Workshop or an Escape Room this weekend?',
      };
      setMessages((prev) => [...prev, botMsg]);
    }, 800);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <h2 className="brand">
  <img src="/genie-lamp%20(1).png" alt="HobbyGenie lamp" />
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
            <p>{msg.text}</p>
          </div>
        ))}
      </div>

      {/* Actions & Input Bar */}
      <footer className="chat-footer">
        <button type="button" className="surprise-btn" onClick={handleSurpriseMe}>
          ✨ Surprise Me!
        </button>
        <form onSubmit={handleSend} className="input-form">
          <input
            type="text"
            placeholder="Type a message or enter your zip code..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="send-btn">Send</button>
        </form>
      </footer>
    </div>
  );
}

export default App;