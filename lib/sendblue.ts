const SENDBLUE_BASE = "https://api.sendblue.co/api/send-message";
const SENDBLUE_TYPING = "https://api.sendblue.co/api/send-typing-indicator";

function sendblueHeaders(): Record<string, string> {
  return {
    "sb-api-key-id": process.env.SENDBLUE_API_KEY!,
    "sb-api-secret-key": process.env.SENDBLUE_API_SECRET!,
    "Content-Type": "application/json",
  };
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Show the iMessage "…" typing bubble while the agent composes a reply.
export async function sendTypingIndicator(): Promise<void> {
  const res = await fetch(SENDBLUE_TYPING, {
    method: "POST",
    headers: sendblueHeaders(),
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
    }),
  });
  if (!res.ok) {
    console.error(`SendBlue typing error ${res.status}: ${await res.text()}`);
  }
}

// Send a plain iMessage to the owner.
export async function sendMessage(content: string): Promise<void> {
  const res = await fetch(SENDBLUE_BASE, {
    method: "POST",
    headers: sendblueHeaders(),
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
      content,
    }),
  });

  if (!res.ok) {
    throw new Error(`SendBlue error ${res.status}: ${await res.text()}`);
  }
}

export async function sendWithTyping(message: string, delayMs = 1500) {
  await sendTypingIndicator();
  await sleep(delayMs);
  await sendMessage(message);
}

export async function sendMultiMessageStream(messages: string[], delayMs = 1500) {
  for (const msg of messages) {
    await sendWithTyping(msg, delayMs);
  }
}
