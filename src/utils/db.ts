import { createClient } from "@supabase/supabase-js";

import type { AppConfig, Database } from "../types";

export function createSupabaseClient(config: AppConfig) {
  return createClient<Database>(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          "X-Client-Info": "drift-backend-phase1",
        },
      },
    },
  );
}
