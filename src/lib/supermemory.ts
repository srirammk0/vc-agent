// Direct Supermemory REST calls from the dashboard — no Modal round-trip needed
// for a simple status write. See agent/memory_store.py for the Python-side
// equivalent (used by the agent itself).

const SUPERMEMORY_BASE_URL = "https://api.supermemory.ai";

type SupermemoryDoc = {
  id: string;
  customId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function findStartupDoc(slug: string): Promise<SupermemoryDoc | null> {
  const res = await fetch(`${SUPERMEMORY_BASE_URL}/v3/documents/list`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ containerTags: ["vc:startups"] }),
  });

  if (!res.ok) {
    throw new Error(`Supermemory list failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const docs: SupermemoryDoc[] = data.memories || [];
  return docs.find((d) => d.customId === slug) || null;
}

/** Mirror a dashboard status change into Supermemory (the agent's actual memory). */
export async function updateSupermemoryStartupStatus(
  slug: string,
  status: "new" | "approved" | "passed"
): Promise<void> {
  const doc = await findStartupDoc(slug);
  if (!doc) return; // not in Supermemory (yet) — nothing to mirror

  const res = await fetch(`${SUPERMEMORY_BASE_URL}/v3/documents/${doc.id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({
      metadata: { ...(doc.metadata || {}), status },
    }),
  });

  if (!res.ok) {
    throw new Error(`Supermemory update failed: ${res.status} ${await res.text()}`);
  }
}
