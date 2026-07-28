const path = require("path");
const { chromium } = require("playwright-core");
const { startups: SEED_STARTUPS, scheduledTasks: SEED_TASKS } = require("./mockData");

const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.DEMO_DASHBOARD_PASSWORD || "demo-local-only";
const VIDEO_DIR = process.env.DEMO_VIDEO_DIR || path.join(__dirname, "video");
const VIEWPORT = { width: 1440, height: 900 };
const SSE_PORT = process.env.DEMO_SSE_PORT || 8791;
const SSE_PROXY_URL = `http://127.0.0.1:${SSE_PORT}/api/chat`;
// Point at a real Chrome/Chromium binary if you have one (avoids a ~150MB
// `playwright install chromium` download). Falls back to Playwright's own
// bundled Chromium — run `npx playwright install chromium` first if you go
// that route.
const CHROME_EXECUTABLE = process.env.DEMO_CHROME_PATH || null;

// ---------------------------------------------------------------------------
// In-memory mock backend (mutated by PATCH/POST so the demo feels alive)
// ---------------------------------------------------------------------------
const store = JSON.parse(JSON.stringify(SEED_STARTUPS));
const tasksStore = JSON.parse(JSON.stringify(SEED_TASKS));

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function setupMockRoutes(page) {
  // Keep the whole recording hermetic: block any request that isn't headed to our
  // own local dev server / mock server, so a fictional company's ".com" domain
  // never actually gets fetched into an iframe embed mid-recording.
  await page.route("**/*", async (route) => {
    let hostname;
    try {
      hostname = new URL(route.request().url()).hostname;
    } catch {
      return route.continue();
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });

  await page.route(/\/api\/startups(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return json(route, { startups: store });
    }
    if (req.method() === "PATCH") {
      const body = JSON.parse(req.postData() || "{}");
      const { slugs, status } = body;
      for (const s of store) {
        if (slugs.includes(s.slug)) {
          s.status = status;
          s.updated_at = new Date().toISOString();
        }
      }
      return json(route, { ok: true });
    }
    return route.continue();
  });

  await page.route(/\/api\/startup\/([^/?]+)(\?.*)?$/, async (route) => {
    const req = route.request();
    const slug = decodeURIComponent(req.url().match(/\/api\/startup\/([^/?]+)/)[1]);
    const item = store.find((s) => s.slug === slug);
    if (req.method() === "GET") {
      if (!item) return json(route, { error: "not found" }, 404);
      return json(route, item);
    }
    if (req.method() === "PATCH") {
      const body = JSON.parse(req.postData() || "{}");
      if (item) Object.assign(item, body, { updated_at: new Date().toISOString() });
      return json(route, { ok: true });
    }
    return route.continue();
  });

  await page.route(/\/api\/feedback$/, async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const item = store.find((s) => s.slug === body.slug);
    if (item) item.status = body.status;
    await new Promise((r) => setTimeout(r, 350));
    return json(route, { ok: true });
  });

  await page.route(/\/api\/enrich$/, async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    return json(route, { ok: true });
  });

  await page.route(/\/api\/scheduled-runs(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      return json(route, { tasks: tasksStore });
    }
    return route.continue();
  });

  await page.route(/\/api\/scheduled-runs\/([^/?]+)$/, async (route) => {
    const req = route.request();
    const id = req.url().match(/\/api\/scheduled-runs\/([^/?]+)/)[1];
    if (req.method() === "DELETE") {
      const idx = tasksStore.findIndex((t) => t.id === id);
      if (idx !== -1) tasksStore.splice(idx, 1);
      return json(route, { ok: true, status: "cancelled" });
    }
    return route.continue();
  });

  await page.route(/\/api\/chat$/, async (route) => {
    await route.continue({ url: SSE_PROXY_URL });
  });
}

// ---------------------------------------------------------------------------
// Cursor overlay — injected before any page script runs, on every navigation.
// ---------------------------------------------------------------------------
const CURSOR_CSS = [
  "#__demo_cursor {",
  "  position: fixed; top: 0; left: 0; width: 20px; height: 20px;",
  "  margin-left: -9px; margin-top: -9px;",
  "  border-radius: 50%;",
  "  background: rgba(20, 20, 22, 0.88);",
  "  box-shadow: 0 0 0 1.5px rgba(255,255,255,0.9), 0 2px 10px rgba(0,0,0,0.35);",
  "  pointer-events: none; z-index: 2147483647;",
  "  transition: transform 0.08s ease;",
  "  will-change: transform;",
  "}",
  "#__demo_cursor.__down { transform: scale(0.75); }",
  ".__demo_ripple {",
  "  position: fixed; width: 10px; height: 10px; margin-left: -5px; margin-top: -5px;",
  "  border-radius: 50%; border: 2px solid rgba(0,122,255,0.55);",
  "  pointer-events: none; z-index: 2147483646;",
  "  animation: __demo_ripple_kf 0.55s ease-out forwards;",
  "}",
  "@keyframes __demo_ripple_kf {",
  "  from { transform: scale(0.3); opacity: 0.9; }",
  "  to { transform: scale(3.2); opacity: 0; }",
  "}",
].join("\n");

function installCursor(css) {
  function mount() {
    const style = document.createElement("style");
    style.textContent = css;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    document.documentElement.appendChild(cursor);
    onReady(cursor);
  }

  if (document.documentElement) {
    mount();
  } else {
    const timer = setInterval(function () {
      if (document.documentElement) {
        clearInterval(timer);
        mount();
      }
    }, 1);
  }

  function onReady(cursor) {
    window.__demoSetCursor = function (x, y) {
      cursor.style.transform = "translate(" + x + "px, " + y + "px)";
    };
    window.__demoCursorDown = function () {
      cursor.classList.add("__down");
      const r = document.createElement("div");
      r.className = "__demo_ripple";
      const m = /-?\d+(?:\.\d+)?/g;
      const t = cursor.style.transform.match(m);
      if (t) {
        r.style.left = t[0] + "px";
        r.style.top = t[1] + "px";
      }
      document.documentElement.appendChild(r);
      setTimeout(function () {
        r.remove();
      }, 600);
    };
    window.__demoCursorUp = function () {
      cursor.classList.remove("__down");
    };
  }
}

const CURSOR_INIT_SCRIPT =
  "(" + installCursor.toString() + ")(" + JSON.stringify(CURSOR_CSS) + ");";

// ---------------------------------------------------------------------------
// Smooth, human-like pointer motion
// ---------------------------------------------------------------------------
const cursorPos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

async function setCursor(page, x, y) {
  cursorPos.x = x;
  cursorPos.y = y;
  await page.evaluate(([x, y]) => window.__demoSetCursor && window.__demoSetCursor(x, y), [x, y]).catch(() => {});
}

async function moveTo(page, x, y, durationMs = 500) {
  const startX = cursorPos.x;
  const startY = cursorPos.y;
  const steps = Math.max(8, Math.round(durationMs / 16));
  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    const cx = startX + (x - startX) * t;
    const cy = startY + (y - startY) * t;
    await page.mouse.move(cx, cy);
    await setCursor(page, cx, cy);
    await page.waitForTimeout(durationMs / steps);
  }
  cursorPos.x = x;
  cursorPos.y = y;
}

async function boxCenter(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element not visible for boundingBox()");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function moveToEl(page, locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const { x, y } = await boxCenter(locator);
  const dx = (opts.dx || 0);
  const dy = (opts.dy || 0);
  await moveTo(page, x + dx, y + dy, opts.duration ?? 550);
}

async function clickEl(page, locator, opts = {}) {
  await moveToEl(page, locator, opts);
  await page.waitForTimeout(90);
  await page.evaluate(() => window.__demoCursorDown && window.__demoCursorDown());
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.evaluate(() => window.__demoCursorUp && window.__demoCursorUp());
  await page.waitForTimeout(opts.after ?? 250);
}

async function typeSlowly(page, locator, text, opts = {}) {
  await clickEl(page, locator, { after: 120 });
  await page.keyboard.type(text, { delay: opts.delay ?? 65 });
}

function pause(page, ms) {
  return page.waitForTimeout(ms);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch({
    ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
    colorScheme: "light",
  });

  await context.addInitScript(CURSOR_INIT_SCRIPT);
  const page = await context.newPage();
  await setupMockRoutes(page);
  await setCursor(page, cursorPos.x, cursorPos.y);

  // ---- 1. Login -----------------------------------------------------------
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await pause(page, 900);
  const pwInput = page.locator('input[name="password"]');
  await typeSlowly(page, pwInput, PASSWORD, { delay: 70 });
  await pause(page, 400);
  await clickEl(page, page.locator('button[type="submit"]'), { after: 200 });
  await page.waitForURL(BASE_URL + "/", { timeout: 15000 }).catch(() => {});
  await pause(page, 900);

  // ---- 2. Dashboard: load data ---------------------------------------------
  await clickEl(page, page.locator('button[title="Refresh list"]'), { after: 900 });
  await pause(page, 700);

  // ---- 3. Tabs tour ---------------------------------------------------------
  for (const label of ["New", "Approved", "Passed", "All"]) {
    await clickEl(page, page.getByRole("button", { name: new RegExp("^" + label) }).first(), { after: 700 });
  }

  // ---- 4. Filters -----------------------------------------------------------
  await clickEl(page, page.locator('button[title="Filter by outreach status"]'), { after: 500 });
  await moveToEl(page, page.getByText("Needs email (not stealth, not yet emailed)"));
  await clickEl(page, page.getByText("Needs email (not stealth, not yet emailed)"), { after: 900 });
  await clickEl(page, page.getByText("Remove filters"), { after: 600 });

  // ---- 5. Search --------------------------------------------------------
  const searchInput = page.locator('input[placeholder="Search startups…"]').first();
  await typeSlowly(page, searchInput, "robot", { delay: 80 });
  await pause(page, 900);
  await clickEl(page, searchInput, { after: 100 });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await pause(page, 500);

  // ---- 6. Command palette -------------------------------------------------
  await page.keyboard.press("Control+k");
  await pause(page, 400);
  await page.keyboard.type("wavelet", { delay: 70 });
  await pause(page, 700);
  const paletteResult = page.locator("text=Wavelet Bio").first();
  await moveToEl(page, paletteResult, { duration: 400 });
  await pause(page, 500);
  await page.keyboard.press("Escape");
  await pause(page, 400);

  // ---- 7. Open a detail panel ----------------------------------------------
  const northlightLink = page.getByRole("link", { name: "Northlight AI" });
  await clickEl(page, northlightLink, { after: 700 });
  // Move the cursor onto the slide-over panel itself before scrolling it — the
  // dimmed backdrop behind it covers the rest of the viewport and isn't scrollable.
  await moveTo(page, VIEWPORT.width - 280, 420, 350);
  await pause(page, 300);
  await page.mouse.wheel(0, 260);
  await pause(page, 900);
  await page.mouse.wheel(0, 260);
  await pause(page, 900);
  await clickEl(page, page.getByRole("button", { name: "Close" }).first(), { after: 500 });

  // ---- 8. Batch select + approve + undo ------------------------------------
  const rows = page.locator("[data-startup-card]");
  const rowCount = await rows.count();
  for (let i = 0; i < Math.min(3, rowCount); i++) {
    const checkbox = rows.nth(i).locator('[role="checkbox"]').first();
    await clickEl(page, checkbox, { after: 220 });
  }
  await pause(page, 500);
  const markApproved = page.getByRole("button", { name: /Mark approved/ });
  if (await markApproved.count()) {
    await clickEl(page, markApproved, { after: 1000 });
    const undoBtn = page.getByText("Undo").first();
    if (await undoBtn.count()) {
      await moveToEl(page, undoBtn);
      await pause(page, 500);
      await clickEl(page, undoBtn, { after: 500 });
    }
  }

  // ---- 9. Speed Review ------------------------------------------------------
  await clickEl(page, page.getByRole("button", { name: "Speed Review" }), { after: 900 });
  const approveBtn = page.getByRole("button", { name: "Approve", exact: true });
  if (await approveBtn.count()) {
    await clickEl(page, approveBtn, { after: 900 });
    const passBtn = page.getByRole("button", { name: "Pass", exact: true });
    if (await passBtn.count()) {
      await clickEl(page, passBtn, { after: 900 });
    }
  }
  const closeReview = page.getByRole("button", { name: "Close speed review" });
  if (await closeReview.count()) {
    await clickEl(page, closeReview, { after: 500 });
  }

  // ---- 10. Per-row status menu ----------------------------------------------
  await pause(page, 300);
  const firstMenuBtn = page.locator("[data-startup-card]").first().getByRole("button", { name: "Change status" });
  await clickEl(page, firstMenuBtn, { after: 600 });
  await pause(page, 900);
  await page.keyboard.press("Escape");
  await pause(page, 400);

  // ---- 11. Agent chat ---------------------------------------------------------
  await clickEl(page, page.getByRole("link", { name: "Agent Chat" }), { after: 900 });
  const suggestion = page.locator(".chat-suggestion").first();
  await clickEl(page, suggestion, { after: 300 });
  await page.waitForSelector(".chat-trace", { timeout: 5000 }).catch(() => {});
  await pause(page, 3500);
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".chat-turn-assistant .chat-thinking");
      return !el;
    },
    { timeout: 12000 }
  ).catch(() => {});
  await pause(page, 800);

  // ---- 12. Scheduled runs modal ------------------------------------------
  await clickEl(page, page.locator('button[title="Scheduled runs"]'), { after: 900 });
  await pause(page, 1600);
  await page.keyboard.press("Escape");
  await pause(page, 400);

  // ---- 13. Exit back to dashboard -----------------------------------------
  await clickEl(page, page.locator('a[title="Exit chat"]'), { after: 1000 });
  await pause(page, 1200);

  await context.close();
  await browser.close();
  console.log("DONE");
})().catch((e) => {
  console.error("RECORDING FAILED:", e);
  process.exit(1);
});
