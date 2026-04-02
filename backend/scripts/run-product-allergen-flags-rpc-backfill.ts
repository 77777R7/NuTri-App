import { supabase } from "../src/supabase.js";
import type { ProductAllergenFlagsSource } from "../src/allergy/productAllergenFlagsRepository.js";

const args = process.argv.slice(2);

const hasFlag = (flag: string) => args.includes(`--${flag}`);

const getArg = (flag: string): string | null => {
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SupportedSource = Exclude<ProductAllergenFlagsSource, "ocr">;
type CursorState = Record<SupportedSource, number>;

type RpcBatchRow = {
  backfill_source: SupportedSource;
  requested_after_id: number;
  last_processed_id: number;
  upserted_count: number;
};

const SUPPORTED_SOURCES = ["all", "dsld", "lnhpd", "iherb_overlay"] as const;

const sourceArg = (getArg("source") ?? "all").trim().toLowerCase();
if (!SUPPORTED_SOURCES.includes(sourceArg as (typeof SUPPORTED_SOURCES)[number])) {
  throw new Error(
    `Unsupported --source value "${sourceArg}". Expected one of: ${SUPPORTED_SOURCES.join(", ")}`,
  );
}

const activeSources: SupportedSource[] =
  sourceArg === "all"
    ? ["dsld", "lnhpd", "iherb_overlay"]
    : [sourceArg as SupportedSource];

// Keep the default cadence conservative because this project has shown
// sustained 522s after larger API-backed backfill runs.
const batchSize = Math.max(1, Number(getArg("batch") ?? "100"));
const idleMs = Math.max(0, Number(getArg("idle-ms") ?? "5000"));
const retryBaseMs = Math.max(250, Number(getArg("retry-base-ms") ?? "5000"));
const maxRetries = Math.max(1, Number(getArg("max-retries") ?? "12"));
const maxBatchesPerSource = Math.max(0, Number(getArg("max-batches-per-source") ?? "0"));
const stopOnSourceComplete = hasFlag("stop-on-source-complete");

const cursors: CursorState = {
  dsld: Math.max(0, Number(getArg("start-dsld-id") ?? "0")),
  lnhpd: Math.max(0, Number(getArg("start-lnhpd-id") ?? "0")),
  iherb_overlay: Math.max(0, Number(getArg("start-iherb-id") ?? "0")),
};

const isRetryableError = (message: string) => {
  const normalized = message.toLowerCase();
  return [
    "522",
    "connection timed out",
    "timeout",
    "failed to fetch",
    "gateway",
    "temporarily unavailable",
    "econnreset",
    "socket hang up",
  ].some((token) => normalized.includes(token));
};

const runRpcBatch = async (
  source: SupportedSource,
  afterId: number,
): Promise<RpcBatchRow> => {
  const { data, error } = await supabase.rpc("backfill_product_allergen_flags_batch", {
    p_source: source,
    p_after_id: afterId,
    p_limit: batchSize,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? (data[0] as RpcBatchRow | undefined) : undefined;
  if (!row) {
    throw new Error(`RPC returned no row for source ${source} after ${afterId}`);
  }

  return row;
};

const runSource = async (source: SupportedSource) => {
  let attempt = 0;
  let batches = 0;

  while (true) {
    const afterId = cursors[source];

    try {
      const row = await runRpcBatch(source, afterId);
      attempt = 0;
      batches += 1;

      const advanced = row.last_processed_id > afterId;
      if (advanced) {
        cursors[source] = row.last_processed_id;
      }

      console.log(
        `[allergy-rpc-backfill][${source}] requestedAfter=${row.requested_after_id} lastProcessed=${row.last_processed_id} upserted=${row.upserted_count} batches=${batches}`,
      );

      if (!advanced || row.upserted_count < batchSize) {
        console.log(
          `[allergy-rpc-backfill][${source}] complete cursor=${cursors[source]}`,
        );
        return;
      }

      if (maxBatchesPerSource > 0 && batches >= maxBatchesPerSource) {
        console.log(
          `[allergy-rpc-backfill][${source}] paused cursor=${cursors[source]} batches=${batches}`,
        );
        return;
      }

      if (idleMs > 0) {
        await sleep(idleMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableError(message);
      attempt += 1;

      console.error(
        `[allergy-rpc-backfill][${source}] batch failed cursor=${afterId} retryable=${retryable} attempt=${attempt}/${maxRetries}: ${message}`,
      );

      if (!retryable || attempt >= maxRetries) {
        throw new Error(
          `[allergy-rpc-backfill][${source}] aborting at cursor=${afterId}: ${message}`,
        );
      }

      const delayMs = retryBaseMs * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }
};

const main = async () => {
  for (const source of activeSources) {
    await runSource(source);
    if (stopOnSourceComplete) {
      break;
    }
  }

  console.log(
    `[allergy-rpc-backfill] done ${JSON.stringify({
      dsld: cursors.dsld,
      lnhpd: cursors.lnhpd,
      iherb_overlay: cursors.iherb_overlay,
    })}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
