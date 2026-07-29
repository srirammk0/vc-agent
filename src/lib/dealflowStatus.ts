/** Client-safe dealflow status constants — keep separate from lib/supabase.ts so
 * browser bundles never pull in the service-role Supabase client at import time. */

export const DEALFLOW_STATUSES = [
  "new",
  "approved",
  "responded",
  "call_booked",
  "passed",
] as const;

export type DealflowStatus = (typeof DEALFLOW_STATUSES)[number];
