import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string): string =>
  readFileSync(decodeURIComponent(new URL(path, import.meta.url).pathname), { encoding: "utf8" });

const searchSource = readSource("../../app/search/index.tsx");
const searchDetailRoutePath = decodeURIComponent(new URL("../../app/search/detail.tsx", import.meta.url).pathname);
const apiClientSource = readSource("../../lib/api-client.ts");
const dashboardSource = readSource("../../components/scan/AnalysisDashboard.tsx");
const topSectionRedesignSource = readSource("../../components/scan/AnalysisTopSectionRedesign.tsx");
const backendSearchSource = readSource("../../backend/src/productSearch.ts");
const searchIndexMigrationSource = readSource("../../supabase/migrations/20260512165918_product_search_index.sql");
const searchIndexTimeoutMigrationSource = readSource(
  "../../supabase/migrations/20260512171345_product_search_index_refresh_timeout.sql",
);
const searchIndexBatchMigrationSource = readSource(
  "../../supabase/migrations/20260512172155_product_search_index_batch_refresh.sql",
);
const searchIndexRuntimeAccelerationMigrationSource = readSource(
  "../../supabase/migrations/20260512180044_product_search_index_runtime_acceleration.sql",
);
const searchHomeCacheMigrationSource = readSource(
  "../../supabase/migrations/20260512180912_product_search_home_cache.sql",
);
const packageSource = readSource("../../package.json");
const searchIndexRefreshScriptSource = readSource("../../scripts/maintainer/refresh-product-search-index.mjs");
const verificationPresentationSource = readSource("../../lib/scan/verificationPresentation.ts");

test("Product Search list exposes pagination, result count, and user-readable match signals", () => {
  assert.match(searchSource, /SEARCH_PAGE_LIMIT = 20/);
  assert.match(searchSource, /product-search-bootstrap-v7/);
  assert.match(searchSource, /bootstrapPayloadHasContinuationContract/);
  assert.match(searchSource, /storedBootstrapHasContinuationContract/);
  assert.match(searchSource, /hasNavigableProductId/);
  assert.match(searchSource, /!allRows\.every\(hasNavigableProductId\)/);
  assert.match(searchSource, /hasInvalidCategoryRows/);
  assert.match(searchSource, /getNavigableSupplements\(payload\.supplements \?\? \[\]\)/);
  assert.match(searchSource, /allRows\.length > SEARCH_PAGE_LIMIT/);
  assert.match(searchSource, /allPagination\?\.hasMore === true/);
  assert.match(
    searchSource,
    /!bootstrapPayloadHasContinuationContract\(\{[\s\S]*categories: nextCategories,[\s\S]*paginationByCategory: nextPaginationByCategory,[\s\S]*\}\)[\s\S]*setBootstrapStatus\('failed'\)[\s\S]*return;/,
  );
  assert.match(searchSource, /catalogStats/);
  assert.match(searchSource, /Search \{catalogTotalLabel\} supplement records/);
  assert.match(searchSource, /\{analysisReadyLabel\} ready for full analysis/);
  assert.match(searchSource, /analysis-ready results/);
  assert.doesNotMatch(searchSource, /Showing \$\{Math\.min\(shownCount, displayTotal\)\} of \$\{totalCopy\} results/);
  assert.match(searchSource, /handleLoadMore/);
  assert.match(searchSource, /matchReason/);
  assert.match(searchSource, /Full facts/);
  assert.match(searchSource, /Basic record/);
  assert.match(searchSource, /Needs label verification/);
  assert.match(apiClientSource, /matchReason\?: string \| null/);
  assert.match(apiClientSource, /catalogStats\?: ProductSearchCatalogStats/);
  assert.match(apiClientSource, /resultTier\?: 'analysis_ready' \| 'basic_catalog' \| 'needs_label_verification'/);
  assert.match(apiClientSource, /resultTierDescription\?: string \| null/);
  assert.match(apiClientSource, /hasMore\?: boolean/);
  assert.match(apiClientSource, /nextPage\?: number \| null/);
  assert.match(apiClientSource, /shown\?: number/);
  assert.match(apiClientSource, /totalIsExact\?: boolean/);
  assert.match(apiClientSource, /paginationByCategory\?: Record<string, SearchResponse\['pagination'\]>/);
});

test("Product Search uses virtualized infinite list continuation", () => {
  assert.match(searchSource, /FlatList/);
  assert.match(searchSource, /onEndReached/);
  assert.match(searchSource, /onEndReachedThreshold=\{0\.55\}/);
  assert.match(searchSource, /const SearchResultRow = React\.memo/);
  assert.match(searchSource, /const ResultSeparator = React\.memo/);
  assert.match(searchSource, /const renderResultItem = React\.useCallback/);
  assert.match(searchSource, /const getItemLayout = React\.useCallback/);
  assert.match(searchSource, /keyExtractor=\{keyExtractor\}/);
  assert.match(searchSource, /renderItem=\{renderResultItem\}/);
  assert.match(searchSource, /ItemSeparatorComponent=\{ResultSeparator\}/);
  assert.match(searchSource, /getItemLayout=\{getItemLayout\}/);
  assert.match(searchSource, /initialNumToRender=\{8\}/);
  assert.match(searchSource, /maxToRenderPerBatch=\{6\}/);
  assert.match(searchSource, /windowSize=\{7\}/);
  assert.doesNotMatch(searchSource, /keyExtractor=\{\(item, index\) =>/);
  assert.match(searchSource, /handleLoadMore/);
  assert.match(searchSource, /const navigableSupplements = getNavigableSupplements\(supplements\)/);
  assert.match(searchSource, /const cachedPageCount = Math\.max\(1, Math\.ceil\(navigableSupplements\.length \/ SEARCH_PAGE_LIMIT\)\)/);
  assert.match(searchSource, /const pageSupplements = navigableSupplements\.slice\(startIndex, endIndex\)/);
  assert.match(searchSource, /buildSearchRequestKey\(category, '', page\)/);
  assert.doesNotMatch(searchSource, /rowDelay = index < SEARCH_PAGE_LIMIT/);
  assert.doesNotMatch(searchSource, /results\.map\(/);
});

test("Product Search has continuation footer states", () => {
  assert.match(searchSource, /loadMoreError/);
  assert.match(searchSource, /SEARCH_LOAD_MORE_TIMEOUT_MS = 10000/);
  assert.match(searchSource, /loadMoreSeqRef/);
  assert.match(searchSource, /controller\.abort\(\)/);
  assert.match(searchSource, /signal: controller\.signal/);
  assert.match(searchSource, /clearTimeout\(requestTimeout\)/);
  assert.match(searchSource, /More results took too long to load\./);
  assert.match(searchSource, /Loading more results/);
  assert.match(searchSource, /Try loading more again/);
  assert.match(searchSource, /End of results/);
});

test("Product Search exposes stable simulator smoke test ids", () => {
  const analysisSource = readSource("../../app/search/analysis.tsx");

  assert.match(searchSource, /testID="product-search-screen"/);
  assert.match(searchSource, /testID="product-search-back-button"/);
  assert.match(searchSource, /testID="product-search-results-list"/);
  assert.match(searchSource, /testID="product-search-input"/);
  assert.match(searchSource, /testID="product-search-result-summary"/);
  assert.match(searchSource, /testID=\{`product-search-result-card-\$\{item\.productId \|\| index\}`\}/);
  assert.match(searchSource, /testID="product-search-loading-more"/);
  assert.match(searchSource, /testID="product-search-load-more-retry"/);
  assert.match(searchSource, /testID="product-search-end-of-results"/);

  assert.match(analysisSource, /testID="database-analysis-screen"/);
  assert.match(analysisSource, /testID="database-analysis-back-button"/);
  assert.match(analysisSource, /testID="database-analysis-loading"/);
  assert.match(analysisSource, /testID="database-analysis-error"/);
  assert.match(analysisSource, /testID="database-analysis-dashboard"/);
});

test("Product Search shows user progress instead of technical page copy", () => {
  assert.match(searchSource, /Showing/);
  assert.match(searchSource, /analysisReadyLabel/);
  assert.match(searchSource, /analysis-ready results/);
  assert.doesNotMatch(searchSource, /Page \{/);
});

test("Product Search initial empty state waits for bootstrap instead of firing duplicate empty search", () => {
  assert.match(
    searchSource,
    /debouncedQuery\.length === 0[\s\S]*!bootstrapSeededRef\.current[\s\S]*bootstrapStatus !== 'failed'[\s\S]*return;/,
  );
});

test("Product Search paints the active empty-search category before full bootstrap completes", () => {
  const runBootstrapStart = searchSource.indexOf("const runBootstrap = async () =>");
  const runBootstrapEnd = searchSource.indexOf("void runBootstrap();", runBootstrapStart);
  const runBootstrapBlock = searchSource.slice(runBootstrapStart, runBootstrapEnd);
  assert.ok(runBootstrapBlock.indexOf("fetchSearchResults({") > -1);
  assert.ok(runBootstrapBlock.indexOf("fetchSearchResults({") < runBootstrapBlock.indexOf("apiClient.searchBootstrap()"));
  assert.match(runBootstrapBlock, /\{ \[activeFilter\]: activePayload\.supplements \}/);
  assert.match(runBootstrapBlock, /applyResolvedResults\(activePayload, \{ animate: true \}\)/);
});

test("Product Search cold fallback de-dupes repeated bootstrap and search requests", () => {
  assert.match(backendSearchSource, /inflightColdBootstrap/);
  assert.match(backendSearchSource, /cachedColdSearchResponses/);
  assert.match(backendSearchSource, /inflightColdSearchResponses/);
  assert.match(backendSearchSource, /buildColdSearchCacheKey/);
  assert.match(backendSearchSource, /getCachedColdSearchResponse/);
  assert.match(backendSearchSource, /getUsableSearchIndex\(\{ warmIfMissing: false \}\)/);
});

test("Product Search reads a lightweight DB search index before the wide overlay table", () => {
  assert.match(searchIndexMigrationSource, /create table if not exists public\.product_search_index/);
  assert.match(searchIndexMigrationSource, /product_search_index_search_text_trgm_idx/);
  assert.match(searchIndexMigrationSource, /product_search_index_strengths_idx/);
  assert.match(searchIndexMigrationSource, /refresh_product_search_index/);
  assert.match(searchIndexMigrationSource, /jsonb_typeof\(p\.supplement_facts->'nutritionalFacts'\) = 'array'/);
  assert.match(searchIndexMigrationSource, /revoke all on function public\.refresh_product_search_index\(\) from public/);
  assert.doesNotMatch(searchIndexMigrationSource, /truncate table public\.product_search_index/);
  assert.match(backendSearchSource, /\.from\("product_search_index"\)/);
  assert.match(backendSearchSource, /fetchColdProductSearchIndexRows/);
  assert.match(backendSearchSource, /isMissingProductSearchIndexTableError/);
  assert.match(backendSearchSource, /ingredient_families,form_signals,strength_signals,facts_status,coverage_status/);
  assert.match(backendSearchSource, /PRODUCT_SEARCH_LIST_INDEX_SELECT/);
  assert.match(backendSearchSource, /PRODUCT_SEARCH_LIST_INDEX_SELECT =\s*\n\s*"id,overlay_id,product_id,upc_code,barcode_gtin14,brand_name,title,image_url,categories,ingredients,primary_facts_amount,serving_size,search_text/);
  assert.match(backendSearchSource, /\.overlaps\("ingredient_families"/);
  assert.match(backendSearchSource, /exact barcode missing from search index/);
  assert.match(packageSource, /"search:refresh-index": "node --import tsx scripts\/maintainer\/refresh-product-search-index\.mjs"/);
  assert.match(searchIndexRefreshScriptSource, /refresh_product_search_index/);
  assert.match(searchIndexTimeoutMigrationSource, /alter function public\.refresh_product_search_index\(\)/);
  assert.match(searchIndexTimeoutMigrationSource, /set statement_timeout = '5min'/);
  assert.match(searchIndexBatchMigrationSource, /refresh_product_search_index_batch/);
  assert.match(searchIndexBatchMigrationSource, /prune_product_search_index/);
  assert.match(searchIndexBatchMigrationSource, /limit v_batch_size/);
  assert.match(searchIndexRuntimeAccelerationMigrationSource, /product_search_index_brand_quality_idx/);
  assert.match(searchIndexRuntimeAccelerationMigrationSource, /product_search_index_brand_name_trgm_idx/);
  assert.match(searchHomeCacheMigrationSource, /create table if not exists public\.product_search_home_cache/);
  assert.match(searchHomeCacheMigrationSource, /payload jsonb not null/);
  assert.match(backendSearchSource, /readPersistedProductSearchHomeBootstrap/);
  assert.match(backendSearchSource, /buildBrowseResponseFromBootstrapPayload/);
  assert.match(backendSearchSource, /PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT = 120/);
  assert.match(backendSearchSource, /buildProductSearchBootstrapPayloadFromRows/);
  assert.match(backendSearchSource, /if \(limit !== DEFAULT_LIMIT\) return null;/);
  assert.match(backendSearchSource, /const startIndex = \(page - 1\) \* limit/);
  assert.match(searchIndexRefreshScriptSource, /refresh_product_search_index_batch/);
  assert.match(searchIndexRefreshScriptSource, /prune_product_search_index/);
  assert.match(searchIndexRefreshScriptSource, /refreshPersistedProductSearchHomeBootstrap/);
});

test("Product Search result tap opens Database analysis directly without barcode scan session", () => {
  const handleOpenStart = searchSource.indexOf("const handleOpenResult");
  const handleOpenEnd = searchSource.indexOf("const handleSelectCategory", handleOpenStart);
  const handleOpenBlock = searchSource.slice(handleOpenStart, handleOpenEnd);
  assert.match(handleOpenBlock, /const productId = item\.productId\?\.trim\(\)/);
  assert.match(handleOpenBlock, /pathname: '\/search\/analysis'/);
  assert.doesNotMatch(handleOpenBlock, /setScanSession\(\{/);
  assert.doesNotMatch(handleOpenBlock, /searchResultSeed/);
  assert.doesNotMatch(handleOpenBlock, /pathname: '\/scan\/result'/);
  assert.doesNotMatch(handleOpenBlock, /pathname: '\/search\/detail'/);
  assert.equal(existsSync(searchDetailRoutePath), false);
});

test("Product Search Database analysis screen is productId-driven and seeds AI deep dive content", () => {
  const analysisSource = readSource("../../app/search/analysis.tsx");
  const databaseAnalysisSource = readSource("../../lib/search/databaseAnalysis.ts");

  assert.match(analysisSource, /apiClient\.searchProductDetail\(productId/);
  assert.match(analysisSource, /<AnalysisDashboard/);
  assert.match(analysisSource, /sourceType="database"/);
  assert.match(analysisSource, /prefetchedDeepDive=\{\{/);
  assert.match(analysisSource, /personalizedGuideMode="hidden"/);
  assert.doesNotMatch(analysisSource, /setScanSession/);
  assert.doesNotMatch(analysisSource, /useStreamAnalysis/);
  assert.match(databaseAnalysisSource, /sourceAttribution: 'label_record'/);
  assert.match(databaseAnalysisSource, /identityStable: true/);
  assert.match(databaseAnalysisSource, /decisionSupportInline/);
  assert.match(dashboardSource, /const isOmega3AggregateLineName = isOmega3TotalLineName/);
  assert.match(dashboardSource, /prefetchedDeepDive\?: AnalysisDashboardPrefetchedDeepDive \| null/);
  assert.match(dashboardSource, /hasPrefetchedScienceDeepDive/);
  assert.match(dashboardSource, /!hasPrefetchedScienceDeepDive\s*&&\s*scienceSidecarDecisionPayload != null/);
  assert.match(dashboardSource, /const lowerFirst/);
  assert.match(dashboardSource, /const findGoalCoverageByLabel/);
  assert.match(topSectionRedesignSource, /TopSectionSecondaryNotePresentation/);
  assert.match(topSectionRedesignSource, /secondaryNote,/);
  assert.match(verificationPresentationSource, /badgeLabel: isLabelRecord \? 'Database label record' : 'Verified source'/);
  assert.match(verificationPresentationSource, /structured product label data in the database/);
  assert.match(dashboardSource, /isDatabaseLabelRecord/);
  assert.match(dashboardSource, /Database label record/);
});
