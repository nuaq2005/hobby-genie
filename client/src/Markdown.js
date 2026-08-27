import React from 'react';

// Tiny Markdown renderer for the subset Gemini emits:
// headings, bold, italic, inline code, links, and bullet / numbered lists.
// Kept dependency-free on purpose.

function renderInline(text, keyPrefix) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const nodes = [];
  let last = 0;
  let match;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      nodes.push(
        <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

export default function Markdown({ text }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', content: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'list', type: list.type, items: list.items });
      list = null;
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'h', content: heading[2] });
      return;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      return;
    }

    flushList();
    paragraph.push(line);
  });
  flushParagraph();
  flushList();

  return (
    <div className="markdown">
      {blocks.map((block, i) => {
        if (block.kind === 'h') {
          return <h4 key={i}>{renderInline(block.content, `h${i}`)}</h4>;
        }
        if (block.kind === 'p') {
          return <p key={i}>{renderInline(block.content, `p${i}`)}</p>;
        }
        const items = block.items.map((item, j) => (
          <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
        ));
        return block.type === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
      })}
    </div>
  );
}
