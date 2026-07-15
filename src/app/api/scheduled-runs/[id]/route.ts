import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const modalUrl = process.env.MODAL_CANCEL_SCHEDULED_TASK_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_CANCEL_SCHEDULED_TASK_URL not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error || "cancel failed" }, { status: 502 });
    }
    if (data.status === "not_found") {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (data.status === "cancel_failed") {
      return NextResponse.json(
        { error: "couldn't reach trigger.dev to cancel it — try again" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, status: data.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cancel request failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { due_at } = await req.json();

  if (!due_at || typeof due_at !== "string") {
    return NextResponse.json({ error: "due_at required" }, { status: 400 });
  }

  const modalUrl = process.env.MODAL_RESCHEDULE_SCHEDULED_TASK_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_RESCHEDULE_SCHEDULED_TASK_URL not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: id, due_at }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error || "reschedule failed" }, { status: 502 });
    }
    if (data.status === "not_found") {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (data.status === "cancel_failed" || data.status === "reschedule_failed") {
      return NextResponse.json(
        { error: "couldn't reach trigger.dev to reschedule it — try again" },
        { status: 502 }
      );
    }
    // Rescheduling creates a NEW scheduled_tasks row server-side (Trigger.dev has
    // no in-place reschedule) — the caller should refetch the list rather than
    // patch this id's due_at locally.
    return NextResponse.json({ ok: true, status: data.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reschedule request failed" },
      { status: 500 }
    );
  }
}
