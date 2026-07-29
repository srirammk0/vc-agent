/** Shared Trigger.dev REST helpers for the dashboard (Vercel server routes). */

const TRIGGER_TASK_BASE = "https://api.trigger.dev/api/v1/tasks";
const TRIGGER_RUNS_URL = "https://api.trigger.dev/api/v2/runs";

export function triggerSecret(): string {
  return process.env.TRIGGER_SECRET_KEY || "";
}

export async function triggerTask(
  taskId: string,
  payload: Record<string, unknown> = {}
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const secret = triggerSecret();
  if (!secret) {
    return { ok: false, error: "TRIGGER_SECRET_KEY is not set on the server" };
  }

  try {
    const res = await fetch(`${TRIGGER_TASK_BASE}/${taskId}/trigger`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `Trigger.dev returned ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    if (!data.id) return { ok: false, error: "Trigger.dev did not return a run id" };
    return { ok: true, runId: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Trigger.dev request failed" };
  }
}

export async function cancelTriggerRun(runId: string): Promise<boolean> {
  const secret = triggerSecret();
  if (!secret || !runId) return false;
  try {
    const res = await fetch(`${TRIGGER_RUNS_URL}/${runId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerMorningWakeup() {
  return triggerTask("daily-morning-wakeup", {});
}
