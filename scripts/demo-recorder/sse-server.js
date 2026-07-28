const http = require("http");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function frame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const PORT = process.env.DEMO_SSE_PORT || 8791;

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });

  const flush = () => res.flush && res.flush();

  await sleep(700);
  res.write(
    frame({
      type: "tool_call",
      tool_call_id: "call_1",
      tool_name: "exa_deep_search_many",
      args: { query: "pre-seed AI infra startups this week" },
    })
  );
  flush();

  await sleep(1100);
  res.write(
    frame({
      type: "tool_result",
      tool_call_id: "call_1",
      result: "Found 6 new candidates across Exa + Linkup signals.",
    })
  );
  flush();

  await sleep(500);
  res.write(
    frame({
      type: "tool_call",
      tool_call_id: "call_2",
      tool_name: "query_startups",
      args: { status: "new" },
    })
  );
  flush();

  await sleep(900);
  res.write(
    frame({
      type: "tool_result",
      tool_call_id: "call_2",
      result: "14 startups currently in New, 5 Approved this week.",
    })
  );
  flush();

  await sleep(400);

  const text =
    "Here's what's new: 6 fresh candidates landed today, mostly AI infra and " +
    "dev-tooling. Two stand out — both pre-seed, both with technical " +
    "founders who've shipped before. I've added them to New with a short " +
    "assessment each. Want me to go deeper on either one?";
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    res.write(frame({ type: "text_delta", text: (i === 0 ? "" : " ") + words[i] }));
    flush();
    await sleep(35 + Math.random() * 45);
  }

  res.write(frame({ type: "done" }));
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SSE mock server on http://127.0.0.1:${PORT}`);
});
