/**
 * lib/email.ts
 *
 * Builds the HTML debrief email and sends it via Composio's GMAIL_SEND_EMAIL action.
 * Composio handles OAuth token refresh — no custom Gmail API setup required.
 */

import { Composio } from "@composio/core";
import type { ScoredStartup } from "./types.js";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
composio.getClient().timeout = 120000;

function scoreColor(score: number): string {
  if (score >= 8) return "#b94f1c";
  if (score >= 7) return "#2a6db5";
  return "#555555";
}

function buildStartupCard(startup: ScoredStartup, index: number): string {
  const isHot = startup.overall_score >= 8;
  const founder = startup.founders?.[0];
  const hasFlags = startup.red_flags && startup.red_flags.length > 0;

  const hotBadge = isHot
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;color:#ea580c;background:#fff7ed;border:1px solid #ffedd5;border-radius:4px;padding:2px 6px;margin-left:8px;vertical-align:middle;">🔥 Hot</span>`
    : "";

  const ycBadge = startup.yc_backed
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;color:#d97706;background:#fef3c7;border:1px solid #fde68a;border-radius:4px;padding:2px 6px;margin-left:8px;vertical-align:middle;">YC</span>`
    : "";

  const outcomeBadge = startup.pass
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;color:#10b981;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:4px;padding:2px 6px;margin-left:8px;vertical-align:middle;">Passed</span>`
    : `<span style="display:inline-block;font-size:10px;font-weight:600;color:#ef4444;background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:2px 6px;margin-left:8px;vertical-align:middle;">Failed</span>`;

  const flagsBlock = hasFlags
    ? `
    <div style="border-left:2px solid #ef4444;padding-left:12px;margin-top:16px;text-align:left;">
      <div style="font-size:10px;color:#ef4444;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">⚠ Red flags</div>
      ${startup.red_flags.map((f) => `<div style="font-size:11px;color:#666666;line-height:1.6;margin-bottom:2px;">· ${f}</div>`).join("")}
    </div>`
    : "";

  const fundingStr = [startup.fundingStage, startup.fundingTotal].filter(Boolean).join(" · ") || "Undisclosed";

  const founderName = founder?.name ?? "Unknown";
  const founderTitle = founder?.title ?? "Founder";
  const founderLinkedIn = founder?.linkedInUrl
    ? `<a href="${founder.linkedInUrl}" style="color:#3b7dd8;text-decoration:none;">${founder.linkedInUrl}</a>`
    : "N/A";

  const interestHeader = startup.pass ? "Why interesting" : "Why failed";

  return `
  <tr>
    <td style="padding:0 0 20px 0;">
      <div style="border:1px solid #ebebeb;border-radius:8px;overflow:hidden;background:#ffffff;">
        <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:20px 24px 20px;vertical-align:top;background:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                <tr>
                  <td style="vertical-align:top;text-align:left;">
                    <div style="margin-bottom:6px;">
                      <span style="font-size:16px;font-weight:700;color:#111111;letter-spacing:-0.2px;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${startup.name}</span>
                      ${outcomeBadge}${hotBadge}${ycBadge}
                    </div>
                    <div style="font-size:13px;color:#666666;line-height:1.5;text-align:left;">${startup.one_liner}</div>
                  </td>
                  <td width="60" style="vertical-align:top;text-align:right;width:60px;flex-shrink:0;">
                    <div style="font-size:20px;font-weight:700;color:${scoreColor(startup.overall_score)};letter-spacing:-0.5px;line-height:1.1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${startup.overall_score.toFixed(1)}</div>
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;line-height:1.1;">/ 10</div>
                  </td>
                </tr>
              </table>

              <div style="height:1px;background:#f0f0ee;line-height:1px;font-size:1px;margin-bottom:16px;">&nbsp;</div>

              <table style="width:100%;border-collapse:collapse;margin-bottom:16px;text-align:left;">
                <tr>
                  <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Website</div>
                    <div style="font-size:13px;color:#3b7dd8;font-weight:500;"><a href="${startup.url || '#'}" style="color:#3b7dd8;text-decoration:none;">${(startup.url || '').replace(/^https?:\/\//, "") || 'N/A'}</a></div>
                  </td>
                  <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Stage</div>
                    <div style="font-size:13px;color:#333333;font-weight:500;">${fundingStr}</div>
                  </td>
                </tr>
                <tr>
                  <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Founded</div>
                    <div style="font-size:13px;color:#333333;font-weight:500;">${startup.foundedYear ?? "—"}</div>
                  </td>
                  <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Headcount</div>
                    <div style="font-size:13px;color:#333333;font-weight:500;">${startup.workforce ? `${startup.workforce} employees` : "—"}</div>
                  </td>
                </tr>
                <tr>
                  <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Founder</div>
                    <div style="font-size:13px;color:#3b7dd8;font-weight:500;"><a href="${founder?.linkedInUrl || '#'}" style="color:#3b7dd8;text-decoration:none;">${founderName}</a></div>
                  </td>
                  <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                    <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:3px;">Background</div>
                    <div style="font-size:13px;color:#333333;font-weight:500;">${founderTitle}</div>
                  </td>
                </tr>
              </table>

              <div style="background:#f8f8f6;border-radius:6px;padding:12px 16px;margin-bottom:16px;text-align:left;">
                <div style="font-size:10px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">${interestHeader}</div>
                <div style="font-size:13px;color:#444444;line-height:1.5;">${startup.why_interesting}</div>
              </div>

              <div style="margin-bottom:0;text-align:left;">
                ${[
                  ["Pedigree", startup.scores.founder_pedigree],
                  ["Moat", startup.scores.technical_moat],
                  ["Thesis", startup.scores.thesis_fit],
                  ["Traction", startup.scores.traction_signals],
                  ["Timing", startup.scores.market_timing],
                ].map(([label, val]) =>
                      `<span style="display:inline-block;font-size:11px;color:#555555;background:#f3f3f1;border-radius:3px;padding:4px 10px;margin-right:8px;margin-bottom:8px;white-space:nowrap;">${label} <strong style="color:#222222;">${val}</strong></span>`
                ).join("")}
              </div>

              ${flagsBlock}
            </td>
          </tr>
        </table>
      </div>
    </td>
  </tr>`;
}

export function buildEmailBody(startups: ScoredStartup[], registryCount: number): string {
  const runTime = new Date().toISOString();
  const cards = startups.map((s, i) => buildStartupCard(s, i)).join("");
  const passedCount = startups.filter(s => s.pass).length;

  const rawTimeStr = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const formattedTime = rawTimeStr.replace(/P[SD]T/, "PT");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Startup Scout Debrief</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;min-height:100vh;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #ebebeb;border-radius:8px;overflow:hidden;">
          
          <!-- Header Card -->
          <tr>
            <td style="padding:24px 32px 16px;background:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="text-align:left;vertical-align:middle;">
                    <div style="font-size:10px;font-weight:600;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Startup Scout</div>
                    <h1 style="font-size:24px;font-weight:700;color:#111111;margin:0 0 6px 0;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${passedCount} new startups found</h1>
                    <div style="font-size:12px;color:#888888;">
                      ${formattedTime} &middot; ${registryCount} in registry
                    </div>
                  </td>
                  <td align="right" style="vertical-align:middle;width:110px;">
                    <span style="
                      font-size:10px;
                      font-weight:600;
                      color:#666666;
                      background:#f3f3f1;
                      border:1px solid #e5e5e5;
                      border-radius:4px;
                      padding:4px 8px;
                    ">Auto-generated</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;background:#ffffff;">
              <div style="height:1px;background:#ebebeb;"></div>
            </td>
          </tr>

          <!-- Cards Area -->
          <tr>
            <td style="padding:24px 32px 8px;background:#ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${cards}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="
              padding:24px 32px;
              background:#ffffff;
              border-top:1px solid #ebebeb;
              text-align:center;
            ">
              <div style="font-size:12px;color:#aaaaaa;line-height:1.6;">
                Sent by <strong style="color:#666666;">Startup Scout Agent</strong> &middot; 
                Run at <code style="color:#666666;">${runTime}</code><br>
                ${passedCount} passed &middot; ${startups.length - passedCount} failed &middot; ${registryCount} total in brain
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendDebrief(
  startups: ScoredStartup[],
  registryCount: number
): Promise<void> {
  if (!process.env.GMAIL_TO) {
    console.warn("[email] GMAIL_TO not set — skipping email send.");
    return;
  }

  const body = buildEmailBody(startups, registryCount);
  const now = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const passedCount = startups.filter(s => s.pass).length;
  const subject = `🚀 ${passedCount} New Startup${passedCount > 1 ? "s" : ""} Found — ${now} Run`;

  await composio.tools.execute("GMAIL_SEND_EMAIL", {
    userId: process.env.COMPOSIO_USER_ID!,
    arguments: {
      to: process.env.GMAIL_TO,
      subject,
      body,
      is_html: true,
    },
    dangerouslySkipVersionCheck: true,
  });

  console.log(`[email] Debrief sent to ${process.env.GMAIL_TO} — "${subject}"`);
}

export async function sendDailyRecap(
  scored: ScoredStartup[],
  registryCount: number
): Promise<void> {
  if (!process.env.GMAIL_TO) {
    console.warn("[email] GMAIL_TO not set — skipping daily recap email send.");
    return;
  }

  const passedCount = scored.filter(s => s.pass).length;
  const failedCount = scored.length - passedCount;

  const body = buildEmailBody(scored, registryCount);
  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const subject = `📅 Startup Scout Daily Recap: ${passedCount} Passed, ${failedCount} Failed — ${todayDate}`;

  await composio.tools.execute("GMAIL_SEND_EMAIL", {
    userId: process.env.COMPOSIO_USER_ID!,
    arguments: {
      to: process.env.GMAIL_TO,
      subject,
      body,
      is_html: true,
    },
    dangerouslySkipVersionCheck: true,
  });

  console.log(`[email] Daily recap sent to ${process.env.GMAIL_TO} — "${subject}"`);
}
