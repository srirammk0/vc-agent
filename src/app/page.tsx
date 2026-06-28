import { loadBrain, type Startup } from "../../lib/blob.js";
import { RunButton } from "./components/RunButton.js";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  new: "text-zinc-400",
  reviewing: "text-blue-400",
  interested: "text-emerald-400",
  passed: "text-red-400",
  pitched: "text-purple-400",
};

export default async function Home() {
  const brain = await loadBrain();
  const startups: Startup[] = Object.values(brain.startups).sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );
  const totalCount = startups.length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            VC Research Agent
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            pre-seed AI startup discovery · texts you on iMessage
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-500">
            {totalCount} startup{totalCount !== 1 ? "s" : ""} in brain
          </span>
          <RunButton />
        </div>
      </div>

      {/* Startup table */}
      {startups.length > 0 ? (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                {["Name", "Score", "Status", "Stage", "Raised", "Found"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {startups.map((s) => (
                <tr
                  key={s.slug}
                  className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-zinc-100">
                    {s.website ? (
                      <a href={s.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold tabular-nums ${
                        s.score >= 75
                          ? "text-emerald-400"
                          : s.score >= 60
                          ? "text-blue-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {s.score}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${STATUS_COLORS[s.status] ?? "text-zinc-400"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{s.stage || "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.raised || "—"}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{s.found || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg px-8 py-16 text-center">
          <p className="text-zinc-500 text-sm">No startups in brain yet.</p>
          <p className="text-zinc-600 text-xs mt-1">
            Wait for the 4-hour sweep, text the agent, or hit run now.
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 flex items-center gap-6 text-xs text-zinc-600">
        <span>Auto sweep: every 4 hours PT · chat it on iMessage</span>
        <span>·</span>
        <a
          href="https://cloud.trigger.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-400 transition-colors"
        >
          trigger.dev dashboard
        </a>
        <span>·</span>
        <a
          href="https://logfire.pydantic.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-400 transition-colors"
        >
          logfire traces
        </a>
      </div>
    </div>
  );
}
