import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase URL or Key is missing. Ensure SUPABASE_URL and SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY are set.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
