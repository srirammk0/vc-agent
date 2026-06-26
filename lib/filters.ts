import { ParallelWebhookPayload } from './types.js';

/**
 * Hard filters based on the PRD:
 * - Over 20 employees
 * - Over $10M total funding
 * - Series A or later
 * - Founded before 2022
 * 
 * Never drop on missing/null data — let through as "unverified".
 */

export function passesHardFilters(payloadText: string, metadata?: {
  workforce?: number | string;
  fundingTotal?: string;
  fundingStage?: string;
  foundedYear?: number;
}): boolean {
  // If we have strict metadata from Exa/Linkup
  if (metadata) {
    if (metadata.foundedYear && metadata.foundedYear < 2022) return false;
    
    if (metadata.workforce) {
      const headcount = typeof metadata.workforce === 'string' 
        ? parseInt(metadata.workforce.replace(/[^0-9]/g, '')) 
        : metadata.workforce;
      if (!isNaN(headcount) && headcount > 20) return false;
    }

    if (metadata.fundingStage) {
      const stage = metadata.fundingStage.toLowerCase();
      if (stage.includes('series a') || stage.includes('series b') || stage.includes('series c')) {
        return false;
      }
    }

    if (metadata.fundingTotal) {
      // parse funding total (e.g. $15M)
      const matches = metadata.fundingTotal.match(/([0-9.]+)\s*([MBK])/i);
      if (matches) {
        const val = parseFloat(matches[1]);
        const mult = matches[2].toUpperCase();
        if (mult === 'M' && val > 10) return false;
        if (mult === 'B') return false;
      }
    }
  }

  // Fallback text parsing if only using webhook payload
  const text = payloadText.toLowerCase();
  
  // Quick text checks (very conservative to avoid false positives)
  if (text.includes('series a') || text.includes('series b')) {
    // Make sure it doesn't say "raised pre-seed, next year series A"
    // Just a rough heuristic if no metadata is available
    if (text.match(/raised.*series [a-z]/) || text.match(/closed.*series [a-z]/)) {
      return false;
    }
  }

  if (text.match(/team of [2-9][1-9]/) || text.match(/[3-9][0-9]\+? employees/)) {
    return false; // over 20 employees
  }

  if (text.match(/\$1[1-9]m/i) || text.match(/\$[2-9][0-9]m/i) || text.match(/\$[0-9]+b/i)) {
    // Match $11M+, $20M+, $1B+
    if (text.match(/(raised|funding|seed).*(\$1[1-9]m|\$[2-9][0-9]m|\$[0-9]+b)/i)) {
      return false;
    }
  }

  return true;
}
