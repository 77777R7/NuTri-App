import { writeFile } from "node:fs/promises";
import { supabase } from "../src/supabase.js";

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const sampleSize = Math.max(1, Number(getArg("sample-size") ?? "200"));
const output = getArg("output") ?? "output/dsld_nonempty_diff.json";

const fetchSample = async () => {
  const { data, error } = await supabase
    .from("product_ingredients")
    .select("id,source_id,form_raw")
    .eq("source", "dsld")
    .not("form_raw", "is", null)
    .neq("form_raw", "")
    .limit(sampleSize);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    source_id: row.source_id as string,
    form_raw: row.form_raw as string,
  }));
};

const recheck = async (ids: string[]) => {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("product_ingredients")
    .select("id,form_raw")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    form_raw: row.form_raw as string | null,
  }));
};

const main = async () => {
  const before = await fetchSample();
  const ids = before.map((row) => row.id);
  const afterRows = await recheck(ids);
  const afterMap = new Map(afterRows.map((row) => [row.id, row.form_raw]));

  const changedToEmpty = before.filter((row) => {
    const next = afterMap.get(row.id);
    return !next || !String(next).trim();
  });

  const payload = {
    source: "dsld",
    sampleSize: before.length,
    changedToEmptyCount: changedToEmpty.length,
    changedToEmptyRows: changedToEmpty,
  };

  await writeFile(output, JSON.stringify(payload, null, 2));
  console.log(`[diagnose-dsld-nonempty-diff] wrote ${output}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
