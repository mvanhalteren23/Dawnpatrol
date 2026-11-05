import type { CuratedVoice } from "@/lib/voices";

// Pick a voice from the curated list, with a preview clip for each (portal and CRM).

export function VoiceOptions({ voices, current, name = "voiceId", allowCustom = false }: { voices: CuratedVoice[]; current: string | null; name?: string; allowCustom?: boolean }) {
  const onList = voices.some((v) => v.id === current);
  return (
    <div className="space-y-2">
      {voices.map((v) => (
        <label key={v.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 text-sm">
          <input type="radio" name={name} value={v.id} defaultChecked={current === v.id} required={!allowCustom} />
          <span className="min-w-28 font-medium">{v.label}</span>
          {v.previewUrl ? <audio controls preload="none" src={v.previewUrl} className="h-8 max-w-56" /> : null}
        </label>
      ))}
      {allowCustom ? (
        <label className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 p-2 text-sm">
          <input type="radio" name={name} value="__custom" defaultChecked={!onList} />
          <span className="min-w-28">Other voice ID</span>
          <input name={`${name}Custom`} defaultValue={onList ? "" : current ?? ""} placeholder="ElevenLabs voice ID (blank = default)" className="input py-1" />
        </label>
      ) : null}
    </div>
  );
}
