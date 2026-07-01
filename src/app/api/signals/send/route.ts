import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

export async function POST(req: NextRequest) {
  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const modalUrl = process.env.MODAL_WEBHOOK_URL?.replace(
    "sendblue-webhook",
    "send-signal-to-agent"
  );
  
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_WEBHOOK_URL not configured" },
      { status: 500 }
    );
  }

  try {
    await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    await supabase
      .from("signals")
      .update({ status: "sent" })
      .eq("id", id);
      
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "send trigger failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
