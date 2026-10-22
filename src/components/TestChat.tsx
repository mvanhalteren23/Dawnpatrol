"use client";
import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

/** Simulated call against the live knowledge base, answered by Claude. */
export function TestChat({ receptionistId, greeting }: { receptionistId: string; greeting: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/receptionists/${receptionistId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "No reply");
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-1">Test call</h2>
      <p className="mb-3 text-xs text-slate-500">Play the caller. Claude answers using this receptionist&apos;s prompt and active knowledge base — the same content synced to ElevenLabs.</p>
      <div className="mb-3 max-h-96 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 text-sm">
        <div className="rounded-lg bg-white p-2 shadow-sm"><b>Receptionist:</b> {greeting}</div>
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg p-2 ${m.role === "user" ? "ml-8 bg-dawn-100" : "bg-white shadow-sm"}`}>
            <b>{m.role === "user" ? "Caller" : "Receptionist"}:</b> {m.content}
          </div>
        ))}
        {busy ? <div className="text-xs text-slate-400">…</div> : null}
      </div>
      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
      <form onSubmit={send} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Hi, do you do emergency calls on Sunday?" className="input" />
        <button className="btn" disabled={busy}>Say</button>
        {messages.length ? <button type="button" className="btn-secondary" onClick={() => setMessages([])}>Reset</button> : null}
      </form>
    </div>
  );
}
