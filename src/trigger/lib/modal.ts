// Shared helper for every Trigger.dev task in this project: forward a call to a
// Modal HTTP endpoint with the shared secret both sides check. Not a task file
// itself (no task()/schedules.task() export), just a plain module.

export async function callModal(
  url: string | undefined,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  if (!url) {
    throw new Error("Modal endpoint URL not configured (check Trigger.dev env vars)");
  }
  const secret = process.env.SCHEDULER_SHARED_SECRET;
  if (!secret) {
    throw new Error("SCHEDULER_SHARED_SECRET not configured");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal call to ${url} failed: ${res.status} ${text}`);
  }

  return res.json().catch(() => ({}));
}
