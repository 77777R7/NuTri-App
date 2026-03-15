import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { detectQualityMarkFromHtml } from "../src/qualityMarks/detector.js";
import {
  buildQualityMarkProgramMatches,
  mergeQualityMarkSummaries,
  summarizeQualityMarkProgramMatches,
} from "../src/qualityMarks/matchers.js";
import { buildQualityMarkSourceCandidates } from "../src/qualityMarks/provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("phase 2 provider builds direct official registry adapters before fallback searches", () => {
  const sources = buildQualityMarkSourceCandidates({
    identityType: "barcode",
    identityValue: "033674121979",
    sourceType: "web",
    brandName: "Sports Research",
    productName: "Triple Strength Omega-3 Fish Oil",
  });

  const official = sources.filter((source) => source.sourceType === "official_registry");
  assert.equal(official[0]?.adapterKind, "nsf_search");
  assert.equal(official[1]?.adapterKind, "usp_listing");
  assert.equal(official[2]?.adapterKind, "informed_choice_search");
  assert.equal(official[3]?.adapterKind, "informed_sport_search");
  assert.equal(official[4]?.adapterKind, "nutrasource_brand_search");
  assert.equal(official[5]?.adapterKind, "nutrasource_product_search");
  assert.match(official[0]?.url ?? "", /search-results\.php\?keyword=/);
  assert.match(official[2]?.url ?? "", /choice\.wetestyoutrust\.com\/supplement-search\?search=/);
  assert.match(official[5]?.url ?? "", /GetFilteredProducts/);
});

test("detector turns NSF result rows into verified registry matches", () => {
  const detection = detectQualityMarkFromHtml(
    {
      ok: true,
      body: `
        <div class="results__company-name">Sports Research</div>
        <div class="results__product-name">Triple Strength Omega-3 Fish Oil</div>
      `,
      error: null,
      statusCode: 200,
      contentType: "text/html",
    },
    {
      url: "https://nsfsport-prod.nsf.org/certified-products/search-results.php?keyword=Sports%20Research",
      sourceType: "official_registry",
      programId: "nsf_certified_for_sport",
      adapterKind: "nsf_search",
      responseFormat: "html",
      brandName: "Sports Research",
      productName: "Triple Strength Omega-3 Fish Oil",
      queryText: "Sports Research Triple Strength Omega-3 Fish Oil",
    },
  );

  assert.equal(detection.status, "detected");
  assert.equal(detection.verificationSummary?.overallStatus, "verified");
  assert.equal(detection.verificationSummary?.officialRegistryVerified, true);
  assert.equal(detection.programMatches[0]?.status, "verified_registry_match");
  assert.equal(detection.programMatches[0]?.productMatched, true);
});

test("detector keeps IFOS brand-only hits ambiguous instead of upgrading them to verified", () => {
  const detection = detectQualityMarkFromHtml(
    {
      ok: true,
      body: JSON.stringify({
        success: true,
        html: `
          <div class="brand-card">
            <h3>Sports Research</h3>
            <span class="certification">IFOS</span>
          </div>
        `,
      }),
      error: null,
      statusCode: 200,
      contentType: "application/json",
    },
    {
      url: "https://certifications.nutrasource.ca/umbraco/surface/NutrasourceContent/GetFilteredBrands?...",
      sourceType: "official_registry",
      programId: "ifos",
      adapterKind: "nutrasource_brand_search",
      responseFormat: "json",
      brandName: "Sports Research",
      productName: "Triple Strength Omega-3 Fish Oil",
      queryText: "Sports Research",
    },
  );

  assert.equal(detection.status, "unknown");
  assert.equal(detection.verificationSummary?.overallStatus, "ambiguous");
  assert.equal(detection.verificationSummary?.warnings.includes("brand_level_only_match"), true);
  assert.equal(detection.verificationSummary?.brandLevelOfficialProgramDetected, true);
  assert.deepEqual(detection.verificationSummary?.brandLevelOfficialProgramLabels, ["IFOS"]);
  assert.equal(detection.verificationSummary?.genericThirdPartyClaimDetected, false);
  assert.equal(detection.programMatches[0]?.matchLevel, "brand");
});

test("detector records USP registry blocks as ambiguous instead of not_proven", () => {
  const detection = detectQualityMarkFromHtml(
    {
      ok: false,
      body: "<html><body>Access denied</body></html>",
      error: "http_403",
      statusCode: 403,
      contentType: "text/html",
    },
    {
      url: "https://www.quality-supplements.org/usp_verified_products",
      sourceType: "official_registry",
      programId: "usp_verified",
      adapterKind: "usp_listing",
      responseFormat: "html",
      brandName: "Nature Made",
      productName: "Vitamin C 1000 mg",
      queryText: "Nature Made Vitamin C 1000 mg",
    },
  );

  assert.equal(detection.status, "unknown");
  assert.equal(detection.verificationSummary?.overallStatus, "ambiguous");
  assert.equal(detection.verificationSummary?.warnings.includes("registry_access_blocked"), true);
});

test("detector does not treat Informed query echo plus no-results page chrome as a verified match", () => {
  const detection = detectQualityMarkFromHtml(
    {
      ok: true,
      body: `
        <h1>Search Results</h1>
        <h5><span>Search results for</span> The Vitamin Shoppe Triple Strength Turmeric with Curcumin 900 mg</h5>
        <div class="content">
          <p>This product has moved to Informed Choice certification.</p>
          <a href="https://choice.wetestyoutrust.com/supplement-search/zinzino/collagen-boozt">Product Page</a>
        </div>
        <div class="app-no-results">
          <span class="app-no-results-text">No results were found.<br>Please type the name of the company or product here.</span>
        </div>
      `,
      error: null,
      statusCode: 200,
      contentType: "text/html",
    },
    {
      url: "https://sport.wetestyoutrust.com/supplement-search?search=The%20Vitamin%20Shoppe%20Triple%20Strength%20Turmeric%20with%20Curcumin%20900%20mg",
      sourceType: "official_registry",
      programId: "informed_sport",
      adapterKind: "informed_sport_search",
      responseFormat: "html",
      brandName: "The Vitamin Shoppe",
      productName: "Triple Strength Turmeric with Curcumin 900 mg",
      queryText: "The Vitamin Shoppe Triple Strength Turmeric with Curcumin 900 mg",
    },
  );

  assert.equal(detection.status, "not_detected");
  assert.equal(detection.verificationSummary?.overallStatus, "not_proven");
  assert.equal(detection.programMatches[0]?.status, "not_found_in_registry");
});

test("detector uses Informed result cards as product-level verified matches", () => {
  const detection = detectQualityMarkFromHtml(
    {
      ok: true,
      body: `
        <div class="grid-container no-padding">
          <div data-drupal-views-infinite-scroll-content-wrapper class="views-infinite-scroll-content-wrapper clearfix grid-x grid-margin-x grid-margin-y">
            <div class="cell views-row small-12 medium-6 large-4 anchor-color-black">
              <div class="views-field views-field-nothing">
                <span class="field-content">
                  <a href="/supplement-search/the-vitamin-shoppe/triple-strength-turmeric-with-curcumin-900-mg" class="anchor-color-black">
                    <h5 class="small-top-margin font-weight-normal secondary-font-family">Triple Strength Turmeric with Curcumin 900 mg</h5>
                    <div class="p small-bottom-margin">The Vitamin Shoppe</div>
                  </a>
                </span>
              </div>
            </div>
          </div>
        </div>
      `,
      error: null,
      statusCode: 200,
      contentType: "text/html",
    },
    {
      url: "https://sport.wetestyoutrust.com/supplement-search?search=The%20Vitamin%20Shoppe%20Triple%20Strength%20Turmeric%20with%20Curcumin%20900%20mg",
      sourceType: "official_registry",
      programId: "informed_sport",
      adapterKind: "informed_sport_search",
      responseFormat: "html",
      brandName: "The Vitamin Shoppe",
      productName: "Triple Strength Turmeric with Curcumin 900 mg",
      queryText: "The Vitamin Shoppe Triple Strength Turmeric with Curcumin 900 mg",
    },
  );

  assert.equal(detection.status, "detected");
  assert.equal(detection.verificationSummary?.overallStatus, "verified");
  assert.equal(detection.programMatches[0]?.status, "verified_registry_match");
});

test("summary merging preserves official not-found warnings even when a page claim exists", () => {
  const registrySummary = summarizeQualityMarkProgramMatches({
    programMatches: buildQualityMarkProgramMatches({
      programIds: ["ifos"],
      status: "not_found_in_registry",
      evidenceUrl: "https://certifications.nutrasource.ca/",
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.9,
      matchLevel: "product",
      brandMatched: false,
      productMatched: false,
      note: "Official registry returned no matching product.",
    }),
    checked: true,
  });
  const pageClaimSummary = summarizeQualityMarkProgramMatches({
    programMatches: buildQualityMarkProgramMatches({
      programIds: ["ifos"],
      status: "claimed_on_product_page",
      evidenceUrl: "https://example.com/product",
      evidenceType: "page",
      sourceType: "brand_official",
      confidence: 0.92,
      matchLevel: "product",
      brandMatched: true,
      productMatched: true,
      note: "Claim on brand page.",
    }),
    checked: true,
  });

  const merged = mergeQualityMarkSummaries(registrySummary, pageClaimSummary);
  assert.equal(merged?.overallStatus, "claimed");
  assert.equal(merged?.officialRegistryChecked, true);
  assert.equal(merged?.warnings.includes("registry_checked_not_found"), true);
});

test("summary merging prefers brand-level official matches over blocked registries and drops search-only noise", () => {
  const blockedUsp = summarizeQualityMarkProgramMatches({
    programMatches: buildQualityMarkProgramMatches({
      programIds: ["usp_verified"],
      status: "ambiguous_match",
      evidenceUrl: "https://www.quality-supplements.org/usp_verified_products",
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.45,
      matchLevel: "product",
      brandMatched: false,
      productMatched: false,
      note: "Access blocked.",
    }),
    checked: true,
    extraWarnings: ["registry_access_blocked", "search_only_evidence"],
  });
  const ifosBrandOnly = summarizeQualityMarkProgramMatches({
    programMatches: buildQualityMarkProgramMatches({
      programIds: ["ifos"],
      status: "ambiguous_match",
      evidenceUrl: "https://certifications.nutrasource.ca/brand?id=THVS",
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.68,
      matchLevel: "brand",
      brandMatched: true,
      productMatched: false,
      note: "Brand-level IFOS result.",
    }),
    checked: true,
    extraWarnings: ["brand_level_only_match"],
  });

  const merged = mergeQualityMarkSummaries(blockedUsp, ifosBrandOnly);
  assert.equal(merged?.overallStatus, "ambiguous");
  assert.equal(merged?.strongestProgramId, "ifos");
  assert.equal(merged?.warnings.includes("brand_level_only_match"), true);
  assert.equal(merged?.warnings.includes("search_only_evidence"), false);
});

test("not-found-only registry checks do not count as generic third-party detection", () => {
  const summary = summarizeQualityMarkProgramMatches({
    programMatches: buildQualityMarkProgramMatches({
      programIds: ["nsf_certified_for_sport"],
      status: "not_found_in_registry",
      evidenceUrl: "https://nsfsport-prod.nsf.org/certified-products/search-results.php?keyword=test",
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.9,
      matchLevel: "product",
      brandMatched: false,
      productMatched: false,
      note: "No match found.",
    }),
    checked: true,
  });

  assert.equal(summary.overallStatus, "not_proven");
  assert.equal(summary.genericThirdPartyClaimDetected, false);
  assert.equal(summary.brandLevelOfficialProgramDetected, false);
  assert.deepEqual(summary.brandLevelOfficialProgramLabels, []);
});

test("decision support source keeps new registry-access wording in place", async () => {
  const source = await readFile(path.resolve(__dirname, "../src/decisionSupport.ts"), "utf8");
  assert.match(source, /registry_access_blocked/);
  assert.match(source, /registry_checked_not_found/);
  assert.match(source, /brand_level_only_match/);
});
