const SENDBLUE_BASE = "https://api.sendblue.co/api/send-message";
const SENDBLUE_TYPING = "https://api.sendblue.co/api/send-typing-indicator";

function sendblueHeaders(): Record<string, string> {
  return {
    "sb-api-key-id": process.env.SENDBLUE_API_KEY!,
    "sb-api-secret-key": process.env.SENDBLUE_API_SECRET!,
    "Content-Type": "application/json",
  };
}

// Show the iMessage "…" typing bubble while the agent composes a reply.
// Best-effort: SendBlue only delivers it if a recent conversation exists.
export async function sendTypingIndicator(maxDurationMs = 120000): Promise<void> {
  const res = await fetch(SENDBLUE_TYPING, {
    method: "POST",
    headers: sendblueHeaders(),
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
      from_number: process.env.SENDBLUE_FROM_NUMBER,
      state: "start",
      max_duration_ms: maxDurationMs,
    }),
  });
  if (!res.ok) {
    throw new Error(`SendBlue typing error ${res.status}: ${await res.text()}`);
  }
}

// Send a plain iMessage to the owner. Used for both research alerts and chat replies.
export async function sendMessage(content: string): Promise<void> {
  const res = await fetch(SENDBLUE_BASE, {
    method: "POST",
    headers: sendblueHeaders(),
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
      // SendBlue's free API plan requires the sending number explicitly.
      from_number: process.env.SENDBLUE_FROM_NUMBER,
      content,
    }),
  });

  if (!res.ok) {
    throw new Error(`SendBlue error ${res.status}: ${await res.text()}`);
  }
}
