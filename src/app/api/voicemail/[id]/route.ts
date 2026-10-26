import { db } from "@/lib/db";
import { verifyAudioToken } from "@/lib/voicemail";

// Voicemail audio for Twilio <Play> (signed URL) and for playback in the CRM.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!verifyAudioToken(id, new URL(req.url).searchParams.get("t"))) return new Response("Forbidden", { status: 403 });
  const vm = await db.voicemailAudio.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!vm) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(vm.data), { headers: { "Content-Type": vm.mimeType, "Cache-Control": "private, max-age=3600" } });
}
