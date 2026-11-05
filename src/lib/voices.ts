import "server-only";
import { getSetting, setSetting } from "./settings";

// The curated voice list (up to 5): the voices clients and the team can pick for an agent. Set in
// CRM Settings by voice ID; the name and preview clip are read from ElevenLabs when saved.

export type CuratedVoice = { id: string; label: string; name: string; previewUrl: string | null };

const KEY = "voices.curated";
export const MAX_CURATED_VOICES = 5;

export async function curatedVoices(): Promise<CuratedVoice[]> {
  try {
    const list = JSON.parse((await getSetting(KEY)) ?? "[]") as CuratedVoice[];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.id === "string") : [];
  } catch {
    return [];
  }
}

/** Look each voice up in the ElevenLabs account (name and preview); unknown IDs are reported, not saved. */
export async function saveCuratedVoices(rows: { id: string; label: string }[]): Promise<{ saved: number; problems: string[] }> {
  const key = process.env.ELEVENLABS_API_KEY;
  const problems: string[] = [];
  const out: CuratedVoice[] = [];
  for (const row of rows.slice(0, MAX_CURATED_VOICES)) {
    const id = row.id.trim();
    if (!id) continue;
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) {
      problems.push(`"${id}" isn't a voice ID`);
      continue;
    }
    let name = row.label.trim();
    let previewUrl: string | null = null;
    if (key) {
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { headers: { "xi-api-key": key } }).catch(() => null);
      if (res?.ok) {
        const v = (await res.json()) as { name?: string; preview_url?: string | null };
        name ||= v.name ?? id;
        previewUrl = v.preview_url ?? null;
      } else {
        problems.push(`${id} isn't in your ElevenLabs account (add it under My Voices first)`);
        continue;
      }
    }
    out.push({ id, label: row.label.trim() || name || id, name: name || id, previewUrl });
  }
  await setSetting(KEY, JSON.stringify(out));
  return { saved: out.length, problems };
}

/** A client may only pick from the list; the team can also keep a voice that isn't on it. */
export async function isCurated(voiceId: string): Promise<boolean> {
  return (await curatedVoices()).some((v) => v.id === voiceId);
}
