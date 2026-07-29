import { NextResponse } from "next/server";

import { triggerMorningWakeup } from "../../../../lib/triggerClient";

/** Manually fire the 8am PT morning wake-up (books today's sweeps + runs one now). */
export async function POST() {
  const result = await triggerMorningWakeup();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, runId: result.runId });
}
