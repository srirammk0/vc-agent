const SENDBLUE_BASE = "https://api.sendblue.co/api/send-message";

export interface StartupAlert {
  name: string;
  score: number;
  oneLiner: string;
  website: string;
  founderLinkedin: string;
}

export async function sendAlert(startup: StartupAlert): Promise<void> {
  const message = [
    `${startup.name} — ${startup.score}/100`,
    ``,
    startup.oneLiner,
    ``,
    startup.website,
    startup.founderLinkedin,
  ].join("\n");

  const res = await fetch(SENDBLUE_BASE, {
    method: "POST",
    headers: {
      "sb-api-key-id": process.env.SENDBLUE_API_KEY!,
      "sb-api-secret-key": process.env.SENDBLUE_API_SECRET!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      number: process.env.ALERT_PHONE_NUMBER,
      content: message,
      send_style: "invisible",
    }),
  });

  if (!res.ok) {
    throw new Error(`SendBlue error ${res.status}: ${await res.text()}`);
  }
}
