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
    let id = row.id.trim();
    if (!id) continue;
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) {
      problems.push(`"${id}" isn't a voice ID`);
      continue;
    }
    let name = row.label.trim();
    let previewUrl: string | null = null;
    if (key) {
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { headers: { "xi-api-key": key } }).catch(() => null);
      let v: { id?: string; name?: string; preview_url?: string | null } | null = res?.ok ? await res.json() : null;
      // A Voice Library voice that isn't in My Voices yet: add it to the account (agents can
      // only speak with voices in the account).
      if (!v) {
        const added = await addLibraryVoice(key, id, row.label.trim());
        if (typeof added === "string") {
          problems.push(`${id}: ${added}`);
          continue;
        }
        v = added;
        id = added.id;
      }
      name ||= v.name ?? id;
      previewUrl = v.preview_url ?? null;
    }
    out.push({ id, label: row.label.trim() || name || id, name: name || id, previewUrl });
  }
  await setSetting(KEY, JSON.stringify(out));
  return { saved: out.length, problems };
}

/** Find a voice in the ElevenLabs Voice Library and add it to My Voices. Returns it, or the problem. */
async function addLibraryVoice(key: string, id: string, label: string): Promise<{ id: string; name?: string; preview_url?: string | null } | string> {
  const headers = { "xi-api-key": key };
  const found = await fetch(`https://api.elevenlabs.io/v1/shared-voices?search=${encodeURIComponent(id)}&page_size=10`, { headers }).catch(() => null);
  if (!found?.ok) return `couldn't reach ElevenLabs to look it up (${found?.status ?? "network error"})`;
  const list = ((await found.json()) as { voices?: { voice_id: string; public_owner_id: string; name?: string; preview_url?: string | null }[] }).voices ?? [];
  const shared = list.find((x) => x.voice_id === id);
  if (!shared) return "not found in your ElevenLabs account or the Voice Library (check the ID)";
  const add = await fetch(`https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(shared.public_owner_id)}/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: label || shared.name || id }),
  }).catch(() => null);
  if (!add?.ok) {
    const detail = add ? await add.text().catch(() => "") : "";
    return /limit|slot/i.test(detail)
      ? "it's in the Voice Library, but your ElevenLabs plan has no free custom voice slots: remove a voice under My Voices, or add it there by hand"
      : `it's in the Voice Library but couldn't be added to My Voices (${add?.status ?? "network error"}): add it there by hand`;
  }
  // The account's copy normally keeps the library ID; use whatever ElevenLabs returns.
  const addedId = ((await add.json().catch(() => ({}))) as { voice_id?: string }).voice_id;
  return { id: addedId || id, name: shared.name, preview_url: shared.preview_url ?? null };
}

/** A client may only pick from the list; the team can also keep a voice that isn't on it. */
export async function isCurated(voiceId: string): Promise<boolean> {
  return (await curatedVoices()).some((v) => v.id === voiceId);
}
