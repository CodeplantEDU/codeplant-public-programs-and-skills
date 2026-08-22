import { Fragment } from "react";

type Props = { text: string };

export function RichText({ text }: Props) {
  const nodes: Array<{ text: string; bold: boolean }> = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push({ text: text.slice(cursor, match.index), bold: false });
    nodes.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push({ text: text.slice(cursor), bold: false });
  if (nodes.length === 0) nodes.push({ text, bold: false });

  return <>{nodes.map((node, index) => node.bold
    ? <strong key={`${index}-${node.text}`}>{node.text}</strong>
    : <Fragment key={`${index}-${node.text}`}>{node.text}</Fragment>)}</>;
}

export function stripBoldMarkup(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}
