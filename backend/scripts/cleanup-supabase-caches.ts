import { supabase } from "../src/supabase.js";

type CleanupTask = {
  name: string;
  args?: Record<string, unknown>;
};

const ttlDaysRaw =
  process.env.BARCODE_RESOLUTION_TRAINING_TTL_DAYS ??
  process.env.BARCODE_TRAINING_TTL_DAYS ??
  "";
const ttlDaysParsed = Number(ttlDaysRaw);
const ttlDays = Number.isFinite(ttlDaysParsed) && ttlDaysParsed > 0 ? ttlDaysParsed : 30;

const tasks: CleanupTask[] = [
  { name: "cleanup_expired_serp_cache" },
  { name: "cleanup_expired_resolution_cache" },
  { name: "cleanup_expired_negative_cache" },
  { name: "cleanup_expired_barcode_regulatory_map" },
  { name: "cleanup_expired_npn_negative_cache" },
  { name: "cleanup_expired_analysis_identity_cache" },
  { name: "cleanup_expired_web_canonical_map" },
  { name: "cleanup_expired_barcode_resolution_training", args: { ttl_days: ttlDays } },
];

const run = async () => {
  let hasFailure = false;
  for (const task of tasks) {
    try {
      const { data, error } = await supabase.rpc(task.name, task.args ?? {});
      if (error) {
        hasFailure = true;
        console.error(`[cleanup] ${task.name} failed: ${error.message}`);
      } else {
        console.log(`[cleanup] ${task.name} deleted=${data ?? 0}`);
      }
    } catch (err) {
      hasFailure = true;
      console.error(
        `[cleanup] ${task.name} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
};

void run();
