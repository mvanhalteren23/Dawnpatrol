import { NextResponse } from "next/server";

// Client calls aren't recorded (transcripts and summaries only), so there is no call audio to serve.
export async function GET() {
  return NextResponse.json({ error: "Calls aren't recorded: see the transcript and summary instead." }, { status: 410 });
}
