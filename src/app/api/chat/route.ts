import { NextRequest, NextResponse } from "next/server";

// modal_app.py's run_web_chat is exposed the same way enrich_startup is —
// a plain dashboard-facing endpoint with no SCHEDULER_SHARED_SECRET check
// (that secret is only for Trigger.dev's calls). Mirrors api/enrich/route.ts.

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const modalUrl = process.env.MODAL_WEB_CHAT_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_WEB_CHAT_URL not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Modal call failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }
    const result = (await res.json().catch(() => ({}))) as { reply?: string };
    return NextResponse.json({ reply: result?.reply ?? "" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "chat request failed" },
      { status: 500 }
    );
  }
}
