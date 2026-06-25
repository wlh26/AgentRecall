import type { ReactElement, ReactNode } from "react";

// A tiny, dependency-free Markdown renderer for short assistant replies.
// Supports: headings, bold/italic, inline code, fenced code blocks, unordered
// and ordered lists (one level), horizontal rules, and blank-line paragraphs.
// It is deliberately minimal — the app avoids heavy markdown dependencies — and
// renders React nodes directly (no dangerouslySetInnerHTML), so it is XSS-safe.

export function Markdown({ text }: { text: string }): ReactElement {
  return <div className="md">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push(
        <pre className="md-code" key={key++}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Blank line.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr className="md-hr" key={key++} />);
      i += 1;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(level, 6)}` as "h1";
      blocks.push(
        <Tag className="md-h" key={key++}>
          {renderInline(heading[2])}
        </Tag>,
      );
      i += 1;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul className="md-ul" key={key++}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol className="md-ol" key={key++}>
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines.
    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p className="md-p" key={key++}>
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
  }

  return blocks;
}

// Inline: handles `code`, **bold**, *italic*/_italic_, and preserves newlines.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on inline code first so emphasis markers inside code are left alone.
  const segments = text.split(/(`[^`]+`)/g);
  let key = 0;
  for (const segment of segments) {
    if (!segment) continue;
    if (segment.startsWith("`") && segment.endsWith("`") && segment.length >= 2) {
      nodes.push(
        <code className="md-inline-code" key={key++}>
          {segment.slice(1, -1)}
        </code>,
      );
      continue;
    }
    nodes.push(...renderEmphasis(segment, () => key++));
  }
  return nodes;
}

function renderEmphasis(text: string, nextKey: () => number): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Bold (**x** or __x__), then italic (*x* or _x_).
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(...withLineBreaks(text.slice(lastIndex, match.index), nextKey));
    const token = match[0];
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={nextKey()}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={nextKey()}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(...withLineBreaks(text.slice(lastIndex), nextKey));
  return nodes;
}

function withLineBreaks(text: string, nextKey: () => number): ReactNode[] {
  const parts = text.split("\n");
  const nodes: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(<br key={nextKey()} />);
    if (part) nodes.push(part);
  });
  return nodes;
}
