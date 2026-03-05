#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const demoRoot = getArg("demo-root", path.join(ROOT, "output", "demo5"));
const outJsonPath = getArg("out-json", path.join(demoRoot, "ux_demo_lint_report.json"));
const outMdPath = getArg("out-md", path.join(demoRoot, "ux_demo_lint_report.md"));

const runNode = (argv, cwd = ROOT) =>
  new Promise((resolve, reject) => {
    execFile("node", argv, { cwd, maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const walk = async (dir) => {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/^demo_ui_example_.*\.md$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

const main = async () => {
  const demoFiles = await walk(demoRoot);
  if (demoFiles.length === 0) {
    throw new Error(`No demo markdown files found under ${demoRoot}`);
  }

  const perDemo = [];
  for (const demoMdPath of demoFiles) {
    const dir = path.dirname(demoMdPath);
    const tracePath = path.join(dir, path.basename(demoMdPath).replace("demo_ui_example_", "demo_ui_example_trace_").replace(/\.md$/i, ".json"));
    try {
      await fs.access(tracePath);
    } catch {
      perDemo.push({
        demoMdPath,
        tracePath,
        ok: false,
        issueCount: 1,
        issues: [{ severity: "high", type: "missing_trace", message: `Missing trace file: ${tracePath}` }],
      });
      continue;
    }

    await runNode([
      path.join("scripts", "maintainer", "lint-demo-ui-example.mjs"),
      "--demo-md",
      demoMdPath,
      "--trace",
      tracePath,
      "--out-dir",
      dir,
    ]);

    const reportPath = path.join(dir, "ux_demo_lint_report.json");
    const report = await readJson(reportPath);
    perDemo.push({
      demoMdPath,
      tracePath,
      ok: Boolean(report?.ok),
      issueCount: Number(report?.issueCount ?? 0),
      issues: Array.isArray(report?.issues) ? report.issues : [],
    });
  }

  const highSeverityCount = perDemo.reduce(
    (sum, row) => sum + row.issues.filter((item) => String(item?.severity).toLowerCase() === "high").length,
    0,
  );

  const aggregate = {
    generatedAt: new Date().toISOString(),
    demoRoot,
    total: perDemo.length,
    passCount: perDemo.filter((row) => row.ok).length,
    failCount: perDemo.filter((row) => !row.ok).length,
    highSeverityCount,
    ok: highSeverityCount === 0,
    reports: perDemo,
  };

  await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
  await fs.writeFile(outJsonPath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");

  const mdLines = [
    "# Demo Batch Lint Report",
    "",
    `- status: ${aggregate.ok ? "pass" : "fail"}`,
    `- total: ${aggregate.total}`,
    `- pass: ${aggregate.passCount}`,
    `- fail: ${aggregate.failCount}`,
    `- high_severity: ${aggregate.highSeverityCount}`,
    "",
    "## Per-demo",
    ...aggregate.reports.map((row, idx) => `${idx + 1}. ${row.ok ? "PASS" : "FAIL"} | ${row.demoMdPath} | issues=${row.issueCount}`),
  ];
  if (!aggregate.ok) {
    mdLines.push("", "## High-severity findings");
    for (const row of aggregate.reports) {
      for (const issue of row.issues.filter((item) => String(item?.severity).toLowerCase() === "high")) {
        mdLines.push(`- ${path.basename(row.demoMdPath)} | ${issue.type}: ${issue.message}`);
      }
    }
  }
  await fs.writeFile(outMdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: aggregate.ok,
        output: {
          json: outJsonPath,
          md: outMdPath,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
