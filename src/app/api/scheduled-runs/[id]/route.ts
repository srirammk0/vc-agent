import { NextRequest, NextResponse } from "next/server";
import { cancelScheduledTask, rescheduleScheduledTask } from "../../../../lib/scheduledTasks";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const status = await cancelScheduledTask(id);
    if (status === "not_found") {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (status === "cancel_failed") {
      return NextResponse.json(
        { error: "couldn't reach trigger.dev to cancel it — try again" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, status });
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
  const dueAtDate = new Date(due_at);
  if (Number.isNaN(dueAtDate.getTime())) {
    return NextResponse.json({ error: "invalid due_at" }, { status: 400 });
  }

  try {
    const status = await rescheduleScheduledTask(id, dueAtDate);
    if (status === "not_found") {
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    }
    if (status === "cancel_failed" || status === "reschedule_failed") {
      return NextResponse.json(
        { error: "couldn't reach trigger.dev to reschedule it — try again" },
        { status: 502 }
      );
    }
    // Rescheduling creates a NEW scheduled_tasks row server-side (Trigger.dev has
    // no in-place reschedule) — the caller should refetch the list rather than
    // patch this id's due_at locally.
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reschedule request failed" },
      { status: 500 }
    );
  }
}
