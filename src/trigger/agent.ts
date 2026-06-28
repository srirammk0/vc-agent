import { task, schedules } from "@trigger.dev/sdk/v3";
import { python } from "@trigger.dev/python";
import { loadBrain, saveBrain } from "../../lib/blob.js";
import { sendMessage } from "../../lib/sendblue.js";

interface AgentPayload {
  mode: "sweep" | "chat";
  message?: string;
}

interface AgentOutput {
  mode: string;
  reply: string;
  brain: Awaited<ReturnType<typeof loadBrain>>;
}

// Shared core: load memory -> run python agent -> persist memory -> iMessage the reply.
async function runAgent(payload: AgentPayload): Promise<AgentOutput> {
  const brain = await loadBrain();

  const result = await python.runScript(
    "./agent/main.py",
    [JSON.stringify({ ...payload, brain })],
    { env: { ...process.env, PYTHONUNBUFFERED: "1" } }
  );

  if (result.exitCode !== 0) {
    throw new Error(`Agent failed (exit ${result.exitCode}):\n${result.stderr}`);
  }

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const out = JSON.parse(lines[lines.length - 1] ?? "{}") as AgentOutput;

  await saveBrain(out.brain);

  if (out.reply) {
    try {
      await sendMessage(out.reply);
    } catch (err) {
      console.error("[sendblue] failed to send reply:", err);
    }
  }

  return out;
}

// Autonomous research sweep — every 4 hours, plus the "run now" button.
export const researchSweep = schedules.task({
  id: "research-sweep",
  cron: { pattern: "0 */4 * * *", timezone: "America/Los_Angeles" },
  maxDuration: 600,
  run: async () => runAgent({ mode: "sweep" }),
});

// Two-way iMessage chat — triggered by the SendBlue inbound webhook.
export const chatReply = task({
  id: "chat-reply",
  maxDuration: 300,
  run: async (payload: { message: string }) =>
    runAgent({ mode: "chat", message: payload.message }),
});
