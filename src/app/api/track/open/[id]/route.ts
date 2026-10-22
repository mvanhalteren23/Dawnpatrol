import { db } from "@/lib/db";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activity = await db.activity.findUnique({ where: { id }, select: { id: true, firstOpenedAt: true } });
  if (activity) {
    await db.activity.update({ where: { id }, data: { openCount: { increment: 1 }, firstOpenedAt: activity.firstOpenedAt ?? new Date() } });
  }
  return new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
}
