import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: NextRequest) {
  const { slug, name } = await req.json();

  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  await supabase
    .from("startups")
    .update({ enrichment_status: "running" })
    .eq("slug", slug);

  const modalUrl = process.env.MODAL_ENRICH_URL;
  if (!modalUrl) {
    return NextResponse.json(
      { error: "MODAL_ENRICH_URL not configured" },
      { status: 500 }
    );
  }

  try {
    await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name }),
    });
  } catch (e) {
    await supabase
      .from("startups")
      .update({ enrichment_status: "pending" })
      .eq("slug", slug);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "enrich trigger failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
