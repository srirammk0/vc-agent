const SENDBLUE_BASE = "https://api.sendblue.co/api/send-message";

// Send a plain iMessage to the owner. Used for both research alerts and chat replies.
export async function sendMessage(content: string): Promise<void> {
  const res = await fetch(SENDBLUE_BASE, {
    method: "POST",
    headers: {
      "sb-api-key-id": process.env.SENDBLUE_API_KEY!,
      "sb-api-secret-key": process.env.SENDBLUE_API_SECRET!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
      content,
    }),
  });

  if (!res.ok) {
    throw new Error(`SendBlue error ${res.status}: ${await res.text()}`);
  }
}
