// Email header safety for mail the CRM sends (pure; unit tested).

/** Header values can't contain line breaks: a CR/LF would let text start new headers (e.g. Bcc). */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII subjects
  const clean = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
}

/** A single bare address: refuses anything that could add recipients or headers. */
export function safeAddress(addr: string): string {
  const clean = headerSafe(addr);
  if (!/^[^\s@<>",;:()\[\]\\]+@[^\s@<>",;:()\[\]\\]+\.[^\s@<>",;:()\[\]\\]+$/.test(clean)) throw new Error(`Not a valid email address: ${clean.slice(0, 80)}`);
  return clean;
}
