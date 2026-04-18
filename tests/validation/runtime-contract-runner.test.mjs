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

test("runtime contract report performs a late bundle retry before failing route health", async () => {
  const pack = {
    version: "runtime-pack",
    metadata: { packRole: "result_page_runtime_contract" },
    scenarios: [baseScenario],
  };
  const baseFetch = buildMockFetch();
  let enrichCalls = 0;

  const report = await createRuntimeContractReport({
    pack,
    apiBaseUrl: "http://127.0.0.1:3001",
    fetchImpl: async (url, options = {}) => {
      const target = new URL(url);
      if (target.pathname === "/api/enrich-stream") {
        enrichCalls += 1;
        if (enrichCalls <= 3) {
          return new Response([
            "event: error",
            'data: {"code":"STREAM_BUSY","retryable":true,"retryAfterMs":1}',
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
      }
      return baseFetch(url, options);
    },
    commonHeaders: { "x-auth-disabled": "1" },
  });

  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 0);
  assert.equal(enrichCalls, 4);
});

test("runtime contract report retries transient usage-section fetch failures before failing the scenario", async () => {
  const pack = {
    version: "runtime-pack",
    metadata: { packRole: "result_page_runtime_contract" },
    scenarios: [baseScenario],
  };
  const baseFetch = buildMockFetch();
  let usageAttempts = 0;

  const report = await createRuntimeContractReport({
    pack,
    apiBaseUrl: "http://127.0.0.1:3001",
    fetchImpl: async (url, options = {}) => {
      const target = new URL(url);
      if (target.pathname === "/api/analysis-section") {
        const body = JSON.parse(options.body);
        if (body.section === "usage" && usageAttempts === 0) {
          usageAttempts += 1;
          throw new Error("fetch failed");
        }
      }
      return baseFetch(url, options);
    },
    commonHeaders: { "x-auth-disabled": "1" },
  });

  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 0);
  assert.equal(usageAttempts, 1);
});

test("runtime contract report treats fixture-only scenarios without real barcodes as not live-applicable", async () => {
  const pack = {
    version: "runtime-pack",
    metadata: { packRole: "result_page_runtime_contract" },
    scenarios: [
      {
        id: "search_origin_fixture_only",
        surface: "search_origin_result",
        category: "omega3_source_oil",
        input: {
          query: "fixture search",
          searchResultSeed: {
            productId: "fixture-krill-oil",
            barcode: null,
            upcCode: null,
            name: "Krill Oil Omega-3",
            brand: "Fixture Brand",
          },
        },
        product: {
          productId: "fixture-krill-oil",
          brand: "Fixture Brand",
          name: "Krill Oil Omega-3",
          barcode: null,
        },
        expected: {
          defaultAnchor: { pass: ["Krill Oil"], warn: [], fail: [] },
        },
      },
    ],
  };

  const report = await createRuntimeContractReport({
    pack,
    apiBaseUrl: "http://127.0.0.1:3001",
    fetchImpl: async () => {
      throw new Error("fixture-only scenario should not hit runtime fetches");
    },
    commonHeaders: { "x-auth-disabled": "1" },
  });

  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.warn, 0);
  assert.equal(report.scenarios[0].warnings.length, 0);
  assert.equal(report.scenarios[0].gates[0].reason, "runtime_fixture_not_live_applicable");
});

test("runtime contract report still warns when a non-fixture scenario is missing its runtime barcode", async () => {
  const pack = {
    version: "runtime-pack",
    metadata: { packRole: "result_page_runtime_contract" },
    scenarios: [
      {
        ...baseScenario,
        id: "scan_missing_runtime_barcode",
        input: { barcode: null },
        product: {
          ...baseScenario.product,
          productId: "41329",
          barcode: null,
        },
      },
    ],
  };

  const report = await createRuntimeContractReport({
    pack,
    apiBaseUrl: "http://127.0.0.1:3001",
    fetchImpl: async () => {
      throw new Error("missing-barcode scenario should short-circuit before fetch");
    },
    commonHeaders: { "x-auth-disabled": "1" },
  });

  assert.equal(report.summary.warn, 1);
  assert.equal(report.scenarios[0].warnings[0].reason, "runtime_barcode_missing");
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

test("runtime contract accepts operational sidecar fallbacks when visible content is present", () => {
  const row = evaluateRuntimeContractRow({
    scenario: baseScenario,
    decisionSupport: { ok: true, status: 200, payload: buildDecisionSupportPayload() },
    analysisBundle: { ok: true, status: 200, latestBundle: buildAnalysisBundle() },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        fallbackUsed: true,
        fallbackReason: "deepseek_http_402",
        ingredientOverview: { paragraph1: "Krill oil is the lead omega-3 source." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        fallbackUsed: true,
        fallbackReason: "llm_unconfigured",
        scientificBackground: { selectedLabel: "Krill Oil", introLine: "Krill oil context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Krill Oil" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Take with food." }] } } },
    },
  });

  const sidecarGate = row.gates.find((gate) => gate.gate === "sidecar_contract");
  assert.ok(sidecarGate);
  assert.equal(sidecarGate.status, "pass");
  assert.equal(sidecarGate.reason, "sidecars_ready_via_operational_fallback");
});

test("runtime contract keeps quality-driven sidecar fallbacks as warnings", () => {
  const row = evaluateRuntimeContractRow({
    scenario: baseScenario,
    decisionSupport: { ok: true, status: 200, payload: buildDecisionSupportPayload() },
    analysisBundle: { ok: true, status: 200, latestBundle: buildAnalysisBundle() },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        fallbackUsed: true,
        fallbackReason: "quality_gate_rejected",
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

  const sidecarGate = row.warnings.find((gate) => gate.gate === "sidecar_contract");
  assert.ok(sidecarGate);
  assert.equal(sidecarGate.reason, "sidecar_fallback_safe");
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
  assert.equal(row.warnings.find((warning) => warning.reason === "score_not_required_for_food_like"), undefined);
});

test("runtime contract does not fail source-copy scenarios on missing analysis bundle when route health is not requested", () => {
  const scenario = {
    ...baseScenario,
    id: "scan_nightly_barleans_algal_oil_source",
    gates: ["default_anchor", "allergy_sensitivity_relevance", "unsafe_language"],
    personas: ["vegan_preference", "fish_allergy"],
    expected: {
      ...baseScenario.expected,
      defaultAnchor: {
        pass: ["Omega-3 Algal Oil", "DHA Algal Oil"],
        warn: ["Omega-3"],
        fail: ["Fish Oil"],
      },
      profileWarnings: {
        mustInclude: [],
        mustNotInclude: ["fish oil", "fish source", "safe for you"],
      },
    },
  };

  const row = evaluateRuntimeContractRow({
    scenario,
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "Omega-3 Algal Oil", dose: "500 mg" }],
        },
        topBlockers: [],
        personalizedResultLane: {
          summary: "This plant-based omega-3 product is label-grounded for vegan preference checks.",
        },
      }),
    },
    analysisBundle: { ok: true, status: 200, latestBundle: null },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "This is a plant-based omega-3 product from algal oil." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Omega-3 Algal Oil", introLine: "Algal oil context." },
      },
    },
    analysisSections: {
      overview: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      ingredients_detail: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      usage: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
    },
  });

  const routeGate = row.gates.find((gate) => gate.gate === "route_health");
  assert.equal(routeGate.status, "pass");
  assert.equal(routeGate.reason, "route_health_not_required_for_scenario");
  assert.equal(row.failures.find((failure) => failure.gate === "route_health"), undefined);
  assert.equal(row.failures.length, 0);
  assert.equal(row.warnings.length, 0);
});

test("runtime contract still fails missing analysis bundle when route health is requested", () => {
  const row = evaluateRuntimeContractRow({
    scenario: {
      ...baseScenario,
      gates: ["route_health", "default_anchor"],
    },
    decisionSupport: { ok: true, status: 200, payload: buildDecisionSupportPayload() },
    analysisBundle: { ok: true, status: 200, latestBundle: null },
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
      overview: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      ingredients_detail: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      usage: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
    },
  });

  const routeGate = row.failures.find((failure) => failure.gate === "route_health");
  assert.ok(routeGate);
  assert.equal(routeGate.reason, "runtime_route_failure");
  assert.deepEqual(routeGate.details.missing, ["analysis_bundle"]);
});

test("runtime contract accepts exact-barcode search-origin results when brand and title are family-compatible aliases", () => {
  const scenario = {
    id: "search_origin_trace_liquid_cal_mag_zinc",
    surface: "search_origin_result",
    category: "mineral_stack",
    severityOnFail: "P1",
    input: {
      query: "00878941000447",
      queryType: "barcode",
      searchResultSeed: {
        productId: "22224",
        barcode: "00878941000447",
        upcCode: "00878941000447",
        name: "Trace, Liquid Cal/Mag/Zinc, Piña Colada, 30 fl oz (887 ml)",
        brand: "Trace",
        category: "Supplement",
      },
    },
    product: {
      productId: "22224",
      brand: "Trace",
      name: "Trace, Liquid Cal/Mag/Zinc, Piña Colada, 30 fl oz (887 ml)",
      barcode: "00878941000447",
    },
    expected: {
      defaultAnchor: {
        pass: ["Calcium", "Magnesium", "Zinc"],
        warn: [],
        fail: ["Serving Size", "Sugars"],
      },
    },
  };

  const row = evaluateRuntimeContractRow({
    scenario,
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "Zinc (as Zinc Gluconate)", dose: "15 mg" }],
        },
      }),
    },
    analysisBundle: {
      ok: true,
      status: 200,
      latestBundle: buildAnalysisBundle({
        meta: {
          productIdentity: {
            brand: "Trace Minerals Research",
            name: "Liquid Cal/Mag/Zinc Natural Pina Colada Flavor",
          },
          authoritativeIdentity: {
            type: "gtin14",
            value: "00878941000447",
          },
          decisionSupportInline: {
            nutriScoreCardV2: { overallScore: 82, overallBand: "Strong" },
            scienceBlock: {
              ingredientRows: [{ name: "Zinc (as Zinc Gluconate)", dose: "15 mg" }],
            },
          },
        },
      }),
    },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "This liquid mineral stack keeps calcium, magnesium, and zinc together." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Zinc (as Zinc Gluconate)", introLine: "Mineral-stack context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Zinc (as Zinc Gluconate)" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Shake well." }] } } },
    },
  });

  assert.equal(row.failures.find((failure) => failure.gate === "canonical_product_consistency"), undefined);
});

test("runtime contract warns instead of failing exact-barcode search-origin results when only the product title is an alias", () => {
  const scenario = {
    id: "search_origin_source_naturals_day_starter_alias",
    surface: "search_origin_result",
    category: "dynamic_post_merge",
    severityOnFail: "P1",
    input: {
      query: "00021078027638",
      queryType: "barcode",
      searchResultSeed: {
        productId: "155200",
        barcode: "00021078027638",
        upcCode: "00021078027638",
        name: "Source Naturals, Caffeine + L-Theanine, 60 Tablets",
        brand: "Source Naturals",
        category: "Supplement",
      },
    },
    product: {
      productId: "155200",
      brand: "Source Naturals",
      name: "Source Naturals, Caffeine + L-Theanine, 60 Tablets",
      barcode: "00021078027638",
    },
    expected: {
      defaultAnchor: {
        pass: ["Caffeine", "L-Theanine"],
        warn: [],
        fail: ["Serving Size", "Sugars"],
      },
    },
  };

  const row = evaluateRuntimeContractRow({
    scenario,
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "L-Theanine", dose: null }],
        },
      }),
    },
    analysisBundle: {
      ok: true,
      status: 200,
      latestBundle: buildAnalysisBundle({
        meta: {
          productIdentity: {
            brand: "Source Naturals",
            name: "Day Starter",
          },
          authoritativeIdentity: {
            type: "gtin14",
            value: "00021078027638",
          },
          decisionSupportInline: {
            nutriScoreCardV2: { overallScore: 82, overallBand: "Strong" },
            scienceBlock: {
              ingredientRows: [{ name: "L-Theanine", dose: null }],
            },
          },
        },
      }),
    },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "Caffeine and L-Theanine are the title-led actives here." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "L-Theanine", introLine: "Caffeine plus L-Theanine context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "L-Theanine" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Use as directed." }] } } },
    },
  });

  assert.equal(row.failures.find((failure) => failure.gate === "canonical_product_consistency"), undefined);
  const canonicalWarning = row.warnings.find((warning) => warning.gate === "canonical_product_consistency");
  assert.equal(canonicalWarning?.status, "warn");
  assert.equal(canonicalWarning?.reason, "search_origin_identity_barcode_brand_consistent_name_alias");
});

test("runtime contract treats Eclectic Herb and Eclectic Institute as exact-barcode brand aliases", () => {
  const scenario = {
    id: "search_origin_eclectic_lemon_balm_brand_alias",
    surface: "search_origin_result",
    category: "botanical_extract",
    severityOnFail: "P1",
    input: {
      query: "00023363102808",
      queryType: "barcode",
      searchResultSeed: {
        productId: "2921",
        barcode: "00023363102808",
        upcCode: "00023363102808",
        name: "Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)",
        brand: "Eclectic Herb",
        category: "Supplement",
      },
    },
    product: {
      productId: "2921",
      brand: "Eclectic Herb",
      name: "Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)",
      barcode: "00023363102808",
    },
    expected: {
      defaultAnchor: {
        pass: ["Lemon Balm"],
        warn: [],
        fail: ["Serving Size", "Sugars"],
      },
    },
  };

  const row = evaluateRuntimeContractRow({
    scenario,
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "Lemon Balm, Dried", dose: null }],
        },
      }),
    },
    analysisBundle: {
      ok: true,
      status: 200,
      latestBundle: buildAnalysisBundle({
        meta: {
          productIdentity: {
            brand: "Eclectic Institute",
            name: "Lemon Balm Grain-Free Alcohol",
          },
          authoritativeIdentity: {
            type: "gtin14",
            value: "00023363102808",
          },
          decisionSupportInline: {
            nutriScoreCardV2: { overallScore: 82, overallBand: "Strong" },
            scienceBlock: {
              ingredientRows: [{ name: "Lemon Balm, Dried", dose: null }],
            },
          },
        },
      }),
    },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "Lemon balm is the title-led botanical here." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Lemon Balm, Dried", introLine: "Lemon balm context." },
      },
    },
    analysisSections: {
      overview: { ok: true, status: 200, payload: { dataStatus: "complete", cover: { summary: "ok" } } },
      ingredients_detail: { ok: true, status: 200, payload: { dataStatus: "complete", detail: { items: [{ name: "Lemon Balm, Dried" }] } } },
      usage: { ok: true, status: 200, payload: { dataStatus: "limited", cover: { bullets: [{ text: "Use as directed." }] } } },
    },
  });

  assert.equal(row.failures.find((failure) => failure.gate === "canonical_product_consistency"), undefined);
  const canonicalWarning = row.warnings.find((warning) => warning.gate === "canonical_product_consistency");
  assert.equal(canonicalWarning?.status, "warn");
  assert.equal(canonicalWarning?.reason, "search_origin_identity_barcode_brand_consistent_name_alias");
});

test("runtime contract treats exact-barcode search-origin identity as consistent when bundle identity is partial", () => {
  const scenario = {
    id: "search_origin_healthforce_spirulina",
    surface: "search_origin_result",
    category: "dynamic_post_merge",
    severityOnFail: "P1",
    gates: ["canonical_product_consistency", "selected_anchor_consistency"],
    input: {
      query: "00650786000048",
      queryType: "barcode",
      searchResultSeed: {
        productId: "19294",
        barcode: "00650786000048",
        upcCode: "00650786000048",
        name: "HealthForce Superfoods, Spirulina Manna, 16 oz (454 g)",
        brand: "HealthForce Superfoods",
        category: "Supplement",
      },
    },
    product: {
      productId: "19294",
      brand: "HealthForce Superfoods",
      name: "HealthForce Superfoods, Spirulina Manna, 16 oz (454 g)",
      barcode: "00650786000048",
    },
    expected: {
      defaultAnchor: {
        pass: ["Spirulina"],
        warn: [],
        fail: ["Vitamin A", "Vitamin D"],
      },
    },
  };

  const row = evaluateRuntimeContractRow({
    scenario,
    decisionSupport: {
      ok: true,
      status: 200,
      payload: buildDecisionSupportPayload({
        scienceBlock: {
          ingredientRows: [{ name: "Spirulina", dose: null }],
        },
      }),
    },
    analysisBundle: { ok: true, status: 200, latestBundle: null },
    ingredientOverview: {
      ok: true,
      status: 200,
      payload: {
        ingredientOverview: { paragraph1: "Spirulina is the lead ingredient." },
      },
    },
    scientificBackground: {
      ok: true,
      status: 200,
      payload: {
        scientificBackground: { selectedLabel: "Spirulina", introLine: "Spirulina context." },
      },
    },
    analysisSections: {
      overview: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      ingredients_detail: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
      usage: { ok: false, status: null, payload: null, error: "authoritative_identity_missing" },
    },
  });

  assert.equal(row.status, "pass");
  assert.equal(row.warnings.length, 0);
  const canonicalGate = row.gates.find((gate) => gate.gate === "canonical_product_consistency");
  assert.equal(canonicalGate?.status, "pass");
  assert.equal(canonicalGate?.reason, "search_origin_identity_barcode_consistent_identity_partial");
});
