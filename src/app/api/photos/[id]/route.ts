import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { readPhotoToken } from "@/lib/photo-token";

// One customer photo: for the signed link sent to the owner (?t=…), or for a signed-in team or portal user.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const media = await db.smsMedia.findUnique({ where: { id } });
  if (!media) return new Response("Not found", { status: 404 });
  const token = new URL(req.url).searchParams.get("t");
  const allowed = token ? readPhotoToken(token) === media.messageSid : await canAccessReceptionist(await getSession(), media.receptionistId);
  if (!allowed) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: { "Content-Type": media.contentType, "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex", "Content-Disposition": "inline" },
  });
}
