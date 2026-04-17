import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScenarioHeaders,
  createRuntimeContractReport,
  evaluateRuntimeContractRow,
  fetchAnalysisBundle,
  flattenStrings,
} from "../../scripts/maintainer/lib/runtime-contract-runner.mjs";

const buildSseBody = (bundle) => [
  "event: analysis_bundle",
  `data: ${JSON.stringify(bundle)}`,
  "",
  "event: done",
  'data: {"status":"ok"}',
  "",
].join("\n");

const baseScenario = {
  id: "scan_runtime_krill",
  surface: "barcode_scan",
  category: "omega3_source_oil",
  personas: ["shellfish_allergy"],
  severityOnFail: "P1",
  input: { barcode: "00740985273678" },
  product: {
    productId: "41329",
    brand: "21st Century",
    name: "21st Century, Krill Oil, 350 mg, 60 Softgels",
    barcode: "00740985273678",
  },
  expected: {
    defaultAnchor: {
      pass: ["Krill Oil", "Omega-3"],
      warn: ["Astaxanthin"],
      fail: ["Fish Oil"],
    },
    profileWarnings: {
      mustInclude: ["shellfish"],
      mustNotInclude: ["safe for you"],
    },
  },
};

const buildDecisionSupportPayload = (overrides = {}) => ({
  status: "ok",
  digest: "digest-123",
  decisionInputsHash: "inputs-123",
  personalizationScopeHash: "scope-123",
  factsDigestHash: "facts-12345678",
  nutriScoreCardV2: {
    overallScore: 82,
    overallBand: "Strong",
  },
  scienceBlock: {
    ingredientRows: [{ name: "Krill Oil", dose: "350 mg" }],
  },
  topBlockers: [{ title: "Shellfish source", why: "Shellfish source may matter for you." }],
  personalizedResultLane: {
    summary: "Shellfish source may matter for your profile.",
  },
  overviewBlock: {
    summary: "Krill oil is the lead omega-3 source here.",
  },
  ...overrides,
});

const buildAnalysisBundle = (overrides = {}) => ({
  meta: {
    promptVersion: "reg_v4.0",
    factsDigestHash: "facts-12345678",
    authoritativeIdentity: {
      type: "gtin14",
      value: "00740985273678",
    },
    productIdentity: {
      brand: "21st Century",
      name: "21st Century, Krill Oil, 350 mg, 60 Softgels",
    },
    decisionSupportInline: {
      nutriScoreCardV2: {
        overallScore: 82,
        overallBand: "Strong",
      },
      scienceBlock: {
        ingredientRows: [{ name: "Krill Oil", dose: "350 mg" }],
      },
    },
    ...overrides.meta,
  },
  sections: {
    overview: {
      cover: { summary: "Krill omega-3 source.", bullets: [] },
      detail: { summary: "Detail summary.", bullets: [] },
      dataStatus: "complete",
    },
    ingredients: {
      cover: { items: [{ name: "Krill Oil", dose: "350 mg", basisTags: [] }] },
      detail: { items: [] },
      dataStatus: "limited",
    },
    usage: {
      cover: { bullets: [] },
      detail: { scheduleFromLabel: [] },
      dataStatus: "limited",
    },
    ...overrides.sections,
  },
});

const buildMockFetch = (overrides = {}) => async (url, options = {}) => {
  const target = new URL(url);
  if (target.pathname === "/api/decision-support/v1") {
    return new Response(JSON.stringify(overrides.decisionSupport ?? buildDecisionSupportPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target.pathname === "/api/enrich-stream") {
    return new Response(buildSseBody(overrides.analysisBundle ?? buildAnalysisBundle()), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (target.pathname === "/api/ingredient-overview/v1") {
    return new Response(JSON.stringify(
      overrides.ingredientOverview ?? {
        status: "ok",
        digest: "digest-123",
        source: "api",
        fallbackUsed: false,
        backgroundRefreshPending: false,
        ingredientOverview: {
          titleLine: "Krill Oil",
          paragraph1: "Krill oil is the main omega-3 source here.",
          paragraph2: "The label keeps the source fairly clear.",
          compareHint: "Compare the source and EPA/DHA disclosure first.",
        },
      },
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target.pathname === "/api/scientific-background/v1") {
    return new Response(JSON.stringify(
      overrides.scientificBackground ?? {
        status: "ok",
        digest: "digest-123",
        source: "api",
        fallbackUsed: false,
        backgroundRefreshPending: false,
        scientificBackground: {
          selectedLabel: "Krill Oil",
          introLine: "Krill oil is an omega-3 source.",
          sections: [
            {
              heading: "Source context",
              summary: "This product is anchored on krill oil rather than a generic oil label.",
              bullets: ["Krill source is explicit on the label."],
            },
          ],
        },
      },
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target.pathname === "/api/analysis-section") {
    const body = JSON.parse(options.body);
    if (body.section === "overview") {
      return new Response(JSON.stringify(
        overrides.overviewSection ?? {
          section: "overview",
          cover: { summary: "Krill omega-3 source.", bullets: [] },
          detail: { summary: "Detail summary.", bullets: [] },
          dataStatus: "complete",
          meta: { factsDigestHash: "facts-12345678" },
        },
      ), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (body.section === "ingredients_detail") {
      return new Response(JSON.stringify(
        overrides.ingredientsSection ?? {
          section: "ingredients_detail",
          cover: { items: [{ name: "Krill Oil", dose: "350 mg", basisTags: [] }] },
          detail: { items: [{ name: "Krill Oil" }] },
          dataStatus: "complete",
          meta: { factsDigestHash: "facts-12345678" },
        },
      ), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(
      overrides.usageSection ?? {
        section: "usage",
        cover: { bullets: [{ text: "Take with food.", basisTags: [] }] },
        detail: { scheduleFromLabel: [] },
        dataStatus: "limited",
        meta: { factsDigestHash: "facts-12345678" },
      },
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`unexpected url ${url}`);
};

test("fetchAnalysisBundle retries a 200 stream that ends before emitting analysis_bundle", async () => {
  let enrichCalls = 0;
  const fetchImpl = async (url) => {
    const target = new URL(url);
    if (target.pathname !== "/api/enrich-stream") throw new Error(`unexpected url ${url}`);
    enrichCalls += 1;
    if (enrichCalls === 1) {
      return new Response([
        "event: done",
        'data: {"status":"ok","reason":"warming"}',
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(buildSseBody(buildAnalysisBundle()), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const result = await fetchAnalysisBundle({
    fetchImpl,
    apiBaseUrl: "http://local.test",
    barcode: "00740985273678",
    headers: {},
    maxRetries: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(Boolean(result.latestBundle), true);
  assert.equal(result.attempts, 2);
});

test("flattenStrings collects nested display strings", () => {
  assert.deepEqual(
    flattenStrings({
      a: "Krill Oil",
      b: ["Omega-3", { c: "Shellfish source" }],
    }),
    ["Krill Oil", "Omega-3", "Shellfish source"],
  );
});

test("buildScenarioHeaders injects persona-aware local personalization context", () => {
  const headers = buildScenarioHeaders({ scenario: baseScenario });
  assert.equal(headers["x-auth-disabled"], "1");
  assert.ok(typeof headers["x-local-personalization"] === "string");
  const encoded = headers["x-local-personalization"].replace(/^local_v1:/, "");
  const payload = JSON.parse(decodeURIComponent(encoded));
  assert.deepEqual(payload.profile?.allergyFlags, ["shellfish"]);
  assert.deepEqual(payload.profile?.preferredTypes, ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein", "Omega-3"]);
});

test("runtime contract report passes when runtime surfaces stay aligned", async () => {
  const pack = {
    version: "runtime-pack",
    metadata: { packRole: "result_page_runtime_contract" },
    scenarios: [baseScenario],
  };

  const report = await createRuntimeContractReport({
    pack,
    apiBaseUrl: "http://127.0.0.1:3001",
    fetchImpl: buildMockFetch(),
    commonHeaders: { "x-auth-disabled": "1" },
  });

  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 0);
  assert.deepEqual(report.summary.failedGates, {});
});

test("runtime contract row fails on main vs mini score mismatch", () => {
  const row = evaluateRuntimeContractRow({
    scenario: baseScenario,
    decisionSupport: { ok: true, status: 200, payload: buildDecisionSupportPayload() },
    analysisBundle: {
      ok: true,
      status: 200,
      latestBundle: buildAnalysisBundle({
        meta: {
          decisionSupportInline: {
            nutriScoreCardV2: { overallScore: 76, overallBand: "Good" },
            scienceBlock: { ingredientRows: [{ name: "Krill Oil" }] },
          },
        },
      }),
    },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "Krill oil is the lead omega-3 source." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Krill Oil", introLine: "Krill oil context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Krill Oil" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Take with food." }] } } },
    },
  });

  const scoreGate = row.failures.find((failure) => failure.gate === "score_consistency");
  assert.ok(scoreGate);
  assert.equal(scoreGate.reason, "main_mini_score_mismatch");
});

test("runtime contract row fails when a visible section is blank", () => {
  const row = evaluateRuntimeContractRow({
    scenario: baseScenario,
    decisionSupport: { ok: true, status: 200, payload: buildDecisionSupportPayload() },
    analysisBundle: { ok: true, status: 200, latestBundle: buildAnalysisBundle() },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "Krill oil is the lead omega-3 source." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Krill Oil", introLine: "Krill oil context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: null, detail: null } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Krill Oil" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Take with food." }] } } },
    },
  });

  const sectionGate = row.failures.find((failure) => failure.gate === "result_page_section_contract");
  assert.ok(sectionGate);
  assert.equal(sectionGate.reason, "result_section_contract_failed");
});

test("runtime contract row fails when persona warning is missing", () => {
  const row = evaluateRuntimeContractRow({
    scenario: {
      ...baseScenario,
      personas: ["dairy_allergy"],
      expected: {
        ...baseScenario.expected,
        profileWarnings: {
          mustInclude: ["dairy"],
          mustNotInclude: ["safe for you"],
        },
      },
    },
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        topBlockers: [{ title: "General warning", why: "General context only." }],
        personalizedResultLane: { summary: "General context only." },
        scienceBlock: {
          ingredientRows: [{ name: "Protein Blend", dose: "25 g" }],
        },
      }),
    },
    analysisBundle: {
      ok: true,
      status: 200,
      latestBundle: buildAnalysisBundle({
        meta: {
          decisionSupportInline: {
            nutriScoreCardV2: {
              overallScore: 82,
              overallBand: "Strong",
            },
            scienceBlock: {
              ingredientRows: [{ name: "Protein Blend", dose: "25 g" }],
            },
          },
        },
      }),
    },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "This product uses a general protein blend." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Protein Blend", introLine: "Protein blend context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Protein Blend" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Take with food." }] } } },
    },
  });

  const personaGate = row.failures.find((failure) => failure.gate === "allergy_sensitivity_relevance");
  assert.ok(personaGate);
  assert.equal(personaGate.reason, "persona_expectation_mismatch");
});

test("runtime contract treats drink-mix hybrid routes as food-like honesty cases instead of hard analysis-bundle failures", () => {
  const row = evaluateRuntimeContractRow({
    scenario: {
      ...baseScenario,
      id: "scan_runtime_hydrationup",
      category: "mineral_stack",
      product: {
        ...baseScenario.product,
        name: "HydrationUP Electrolyte Drink Mix",
      },
      expected: {
        ...baseScenario.expected,
        defaultAnchor: {
          pass: ["HydrationUP", "Electrolyte Drink Mix"],
          warn: [],
          fail: [],
        },
      },
    },
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "HydrationUP" }],
        },
      }),
    },
    analysisBundle: { ok: true, status: 200, latestBundle: null },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "HydrationUP reads like a drink-mix formula." },
        fallbackUsed: true,
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "HydrationUP", introLine: "Drink mix context." },
        fallbackUsed: true,
      },
    },
    analysisSections: {
      overview: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      ingredients_detail: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      usage: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
    },
  });

  assert.equal(row.failures.find((failure) => failure.gate === "route_health"), undefined);
  assert.equal(row.failures.find((failure) => failure.gate === "result_page_section_contract"), undefined);
});
