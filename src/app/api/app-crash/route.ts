// Crash reports from the Android app (android/.../CrmApplication.java): the error and stack trace,
// app and Android version and phone model. Logged for diagnosis only; nothing is stored.
export async function POST(req: Request) {
  const text = (await req.text().catch(() => "")).slice(0, 15000);
  if (!text.startsWith("app ")) return new Response(null, { status: 400 });
  console.error(`android app crash: ${text}`);
  return new Response(null, { status: 204 });
}
