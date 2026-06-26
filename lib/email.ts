import { Composio } from "@composio/core";
import type { ScoredStartup } from "./types.js";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
composio.getClient().timeout = 120000;

function scoreColor(score: number): string {
  if (score >= 8) return "#b94f1c";
  if (score >= 7) return "#2a6db5";
  return "#555";
}

export function buildStartupCard(startup: ScoredStartup): string {
  const isHot = startup.overall_score >= 8;
  const founder = startup.founders?.[0];
  const hasFlags = startup.red_flags && startup.red_flags.length > 0;

  const hotBadge = isHot
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;color:#b94f1c;background:#fdf0eb;border:1px solid #f5cbb8;border-radius:3px;padding:2px 7px;margin-left:7px;vertical-align:middle;">🔥 Hot</span>`
    : "";

  const ycBadge = startup.yc_backed
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;color:#8a5c00;background:#fef6e4;border:1px solid #f5dfa0;border-radius:3px;padding:2px 7px;margin-left:7px;vertical-align:middle;">YC</span>`
    : "";

  const flagsBlock = hasFlags
    ? `
    <div style="border-left:2px solid #f0a070;padding-left:12px;margin-top:16px;">
      <div style="font-size:10px;color:#c47040;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin-bottom:6px;">⚠ Red flags</div>
      ${startup.red_flags.map((f) => `<div style="font-size:11px;color:#666;line-height:1.6;margin-bottom:2px;">· ${f}</div>`).join("")}
    </div>`
    : "";

  const fundingStr = [startup.fundingStage, startup.fundingTotal].filter(Boolean).join(" · ") || "Undisclosed";

  return `
  <div style="border:1px solid #ebebeb;border-radius:8px;overflow:hidden;margin-bottom:20px;background:#ffffff;">
    <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:20px 24px 20px;vertical-align:top;background:#ffffff;">
          <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:12px;">
            <tr>
              <td style="vertical-align:top;text-align:left;">
                <div style="margin-bottom:6px;">
                  <span style="font-size:16px;font-weight:600;color:#111;letter-spacing:-0.2px;vertical-align:middle;">${startup.company_name}</span>
                  ${hotBadge}${ycBadge}
                </div>
                <div style="font-size:13px;color:#666;line-height:1.5;">${startup.one_liner}</div>
              </td>
              <td width="60" style="vertical-align:top;text-align:right;width:60px;flex-shrink:0;">
                <div style="font-size:20px;font-weight:700;color:${scoreColor(startup.overall_score)};letter-spacing:-0.5px;line-height:1.1;">${startup.overall_score.toFixed(1)}</div>
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;line-height:1.1;">/ 10</div>
              </td>
            </tr>
          </table>

          <div style="height:1px;background:#f0f0ee;line-height:1px;font-size:1px;margin-bottom:16px;">&nbsp;</div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr>
              <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Website</div>
                <div style="font-size:13px;color:#3b7dd8;font-weight:500;"><a href="${startup.url || '#'}" style="color:#3b7dd8;text-decoration:none;">${(startup.url || '').replace(/^https?:\/\//, "") || 'N/A'}</a></div>
              </td>
              <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Stage</div>
                <div style="font-size:13px;color:#333;font-weight:500;">${fundingStr}</div>
              </td>
            </tr>
            <tr>
              <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Founded</div>
                <div style="font-size:13px;color:#333;font-weight:500;">${startup.foundedYear ?? "—"}</div>
              </td>
              <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Headcount</div>
                <div style="font-size:13px;color:#333;font-weight:500;">${startup.workforce ? `${startup.workforce} employees` : "—"}</div>
              </td>
            </tr>
            ${founder ? `
            <tr>
              <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Founder</div>
                <div style="font-size:13px;font-weight:500;"><a href="${founder.linkedInUrl || '#'}" style="color:#3b7dd8;text-decoration:none;">${founder.name}</a></div>
              </td>
              <td style="width:50%;padding:6px 0 6px 12px;vertical-align:top;">
                <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:3px;">Background</div>
                <div style="font-size:13px;color:#333;font-weight:500;">${founder.title}</div>
              </td>
            </tr>` : ""}
          </table>

          <div style="background:#f8f8f6;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
            <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;margin-bottom:6px;">Why interesting</div>
            <div style="font-size:13px;color:#444;line-height:1.5;">${startup.why_interesting}</div>
          </div>

          <div style="margin-bottom:0;">
            ${[
              ["Pedigree", startup.scores.founder_pedigree],
              ["Moat", startup.scores.technical_moat],
              ["Thesis", startup.scores.thesis_fit],
              ["Traction", startup.scores.traction_signals],
              ["Timing", startup.scores.market_timing],
            ].map(([label, val]) =>
                  `<span style="display:inline-block;font-size:11px;color:#555;background:#f3f3f1;border-radius:3px;padding:4px 10px;margin-right:8px;margin-bottom:8px;white-space:nowrap;">${label} <strong style="color:#222;">${val}</strong></span>`
            ).join("")}
          </div>

          ${flagsBlock}
        </td>
      </tr>
    </table>
  </div>`;
}

function buildHTMLWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Startup Scout</title></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:32px 16px;">
  <tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
    <tr><td>
      <div style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <div style="padding:24px 32px 16px;">
          ${content}
        </div>
      </div>
    </td></tr>
  </table>
  </td></tr>
</table>
</body>
</html>`;
}

export async function sendRealtimeAlert(startup: ScoredStartup, source: string): Promise<void> {
  if (!process.env.GMAIL_TO) return;

  const subject = `🚀 ${startup.company_name} · ${startup.overall_score}/10 · via ${source}`;
  const body = buildHTMLWrapper(buildStartupCard(startup));

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
}

export async function sendBatchAlert(startups: ScoredStartup[], timeContext: string): Promise<void> {
  if (!process.env.GMAIL_TO || startups.length === 0) return;

  const n = startups.length;
  const subject = `🔍 ${n} new startup${n > 1 ? 's' : ''} · ${timeContext} sweep`;
  const cards = startups.map(buildStartupCard).join("");
  const body = buildHTMLWrapper(`<h2>${n} Companies Found</h2><br/>${cards}`);

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
}

export async function sendDailyBrief(
  dateStr: string,
  runs: number,
  triggers: number,
  passed: number,
  topPicks: ScoredStartup[],
  patterns: string,
  focus: string,
  registryCount: number
): Promise<void> {
  if (!process.env.GMAIL_TO) return;

  const subject = `📊 Daily Brief · ${dateStr} · ${passed} found today`;
  
  const content = `
    <h3 style="color:#333;border-bottom:1px solid #eee;padding-bottom:10px;">TODAY'S SUMMARY</h3>
    <table style="width:100%;margin-bottom:20px;font-size:14px;color:#555;">
      <tr><td style="padding:4px 0;width:150px;">Runs completed:</td><td><strong>${runs}</strong></td></tr>
      <tr><td style="padding:4px 0;">Triggers fired:</td><td><strong>${triggers}</strong></td></tr>
      <tr><td style="padding:4px 0;">Companies passed:</td><td><strong>${passed}</strong></td></tr>
    </table>

    <h3 style="color:#333;border-bottom:1px solid #eee;padding-bottom:10px;">TOP PICKS TODAY</h3>
    ${topPicks.map(buildStartupCard).join("") || '<p style="color:#888;">No top picks today.</p>'}

    <h3 style="color:#333;border-bottom:1px solid #eee;padding-bottom:10px;margin-top:20px;">PATTERNS NOTICED</h3>
    <p style="font-size:14px;color:#444;line-height:1.6;">${patterns}</p>

    <h3 style="color:#333;border-bottom:1px solid #eee;padding-bottom:10px;margin-top:20px;">SUGGESTED FOCUS TOMORROW</h3>
    <p style="font-size:14px;color:#444;line-height:1.6;">${focus}</p>

    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
      Startup Scout · ${dateStr} · ${registryCount} total in memory
    </div>
  `;

  await composio.tools.execute("GMAIL_SEND_EMAIL", {
    userId: process.env.COMPOSIO_USER_ID!,
    arguments: {
      to: process.env.GMAIL_TO,
      subject,
      body: buildHTMLWrapper(content),
      is_html: true,
    },
    dangerouslySkipVersionCheck: true,
  });
}
