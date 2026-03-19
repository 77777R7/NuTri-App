## na-brand-discovery-b

Status: execution success with access blockers on selected retailer/official surfaces

Run scope:
- Assigned brands: `Garden of Life`, `Codeage`, `Natrol`
- Priority: strongest current evidence only, not exhaustive catalog mapping

### Garden of Life

Sources checked:
- Official site: `https://www.gardenoflife.com/` plus direct product/PDF fetch attempts
- iHerb: brand and product URLs
- Amazon: direct product page, brand/catalog search/store surfaces

Confirmed North America site coverage:
- Official North America site coverage is only weakly confirmed from this environment. Search-indexed `gardenoflife.com` product routes and traceability PDFs exist, but live direct fetches returned either Nestle maintenance or Akamai `403`.
- iHerb coverage is strong at the URL level, but direct page access from this environment is blocked by Cloudflare challenge.
- Amazon coverage is strong enough for recovery: one direct product page resolved live, and Amazon/WFM catalog surfaces exist for the brand.

Strongest candidate URLs/assets:
- Official product URL: `https://www.gardenoflife.com/vitamin-code-raw-d3-5000-vegetarian-capsules`
- Official product URL: `https://www.gardenoflife.com/dr-formulated-probiotics-once-daily-womens-vegetarian-capsules`
- Official traceability PDF asset: `https://www.gardenoflife.com/media/traceability/Answer_StickPacks_LabelClaims.pdf`
- Official traceability PDF asset: `https://www.gardenoflife.com/media/traceability/TruOmega3_LabelClaims.pdf`
- iHerb brand page: `https://www.iherb.com/c/garden-of-life`
- iHerb product page: `https://www.iherb.com/pr/garden-of-life-vitamin-code-raw-d3-125-mcg-5-000-iu-60-veggie-capsules/23384`
- iHerb product page: `https://www.iherb.com/pr/garden-of-life-dr-formulated-probiotics-once-daily-women-s-50-billion-30-veggie-capsules/63997`
- Amazon direct product page: `https://www.amazon.com/Garden-Life-Raw-Supplement-Vegetarian/dp/B005JAT318/`
- Amazon catalog/store surface: `https://www.amazon.com/stores/page/9E4A439A-32CA-45B2-AFAB-E8943D8AB9A7/search?ref_=ast_bln&store_ref=bl_ast_dp_brandLogo_sto&terms=Garden%20of%20Life`

Blocker notes:
- `gardenoflife.com` root, product URLs, and traceability PDFs returned maintenance/`403` from this environment on 2026-03-17.
- iHerb direct browsing/fetching hit Cloudflare security verification.
- Amazon direct D3 product URL resolved, but search/store navigation was less stable than direct-entry URLs.

Recovery usefulness assessment:
- Medium. Retailer recovery should be workable because iHerb and Amazon both show clear product coverage, but official-site fallback is currently fragile until Garden of Life restores normal live access from this environment.

### Codeage

Sources checked:
- Official site: live browser session on `codeage.com`, robots, sitemap index, product sitemap, collection sitemap, product HTML
- iHerb: brand and product URLs
- Amazon: direct product page for confirmed ASIN

Confirmed North America site coverage:
- Official North America coverage is strong. `codeage.com` resolved live to `https://www.codeage.com/en-ca`, and the sitemap exposes dense US/Canada product and collection coverage.
- iHerb coverage is confirmed at the URL level, though direct fetches from this environment were blocked by Cloudflare challenge.
- Amazon coverage is confirmed for at least one flagship supplement SKU, with the official product HTML also carrying an `asin:` tag for cross-matching.

Strongest candidate URLs/assets:
- Official sitemap index: `https://www.codeage.com/sitemap.xml`
- Official product sitemap: `https://www.codeage.com/en-ca/sitemap_products_1.xml?from=1380784013389&to=15414130311537`
- Official collection hub: `https://www.codeage.com/en-ca/collections/vitamins-multivitamins-supplements`
- Official collection hub: `https://www.codeage.com/en-ca/collections/healthy-aging`
- Official product page: `https://www.codeage.com/en-ca/products/multi-collagen-protein-powder-peptides-5-types-supplement`
- Official product page: `https://www.codeage.com/en-ca/products/liposomal-nmn-supplement-reveratrol-betaine-vitamin-b`
- Official supplement-facts asset: `https://www.codeage.com/cdn/shop/files/MultiCollagenPowderMini-CA_SF_2000.png?v=1707493726`
- Official supplement-facts asset: `https://www.codeage.com/cdn/shop/files/NMNPlatinum-CA_NewBMedias_SF.jpg?v=1759773185`
- iHerb brand page: `https://www.iherb.com/c/codeage`
- iHerb product page: `https://www.iherb.com/pr/codeage-multi-collagen-peptides-5-types-collagen-i-ii-iii-v-x-chocolate-18-17-oz-515-g/117496`
- iHerb product page: `https://www.iherb.com/pr/codeage-grass-fed-beef-organs-liver-heart-kidney-pancreas-spleen-180-capsules/117498`
- Amazon direct product page: `https://www.amazon.com/dp/B07RZP8KPR`

Blocker notes:
- iHerb direct browsing/fetching hit Cloudflare security verification.
- I did not find a clean product-specific PDF download on Codeage; the strongest reusable assets are embedded supplement-facts/label images and the sitemap/product JSON.

Recovery usefulness assessment:
- High. Codeage has the cleanest official recovery surface in this batch: live sitemap coverage, CA locale product pages, dense category hubs, and directly reusable supplement-facts assets.

### Natrol

Sources checked:
- Official site: live browser session on `natrol.com`, robots, sitemap index, product sitemap, collection sitemap, product HTML
- iHerb: product URLs
- Amazon: direct product page, official-site Amazon store/product links

Confirmed North America site coverage:
- Official North America coverage is strong. `natrol.com` was live, product and collection sitemaps were accessible, and the homepage/product HTML exposed direct Amazon linkage.
- iHerb coverage is confirmed at the product URL level, but direct access from this environment was blocked/challenged.
- Amazon coverage is strong. Natrol’s official site links directly to its Amazon store and product pages, and direct Amazon product resolution worked live.

Strongest candidate URLs/assets:
- Official sitemap index: `https://www.natrol.com/sitemap.xml`
- Official all-products collection: `https://www.natrol.com/collections/all-products`
- Official sleep collection: `https://www.natrol.com/collections/sleep-aid-supplements`
- Official product page: `https://www.natrol.com/products/melatonin-gummies-sleep-support-strawberry-10mg`
- Official product page: `https://www.natrol.com/products/high-absorption-magnesium-glycinate`
- Official label asset: `https://cdn.shopify.com/s/files/1/0616/2130/5564/files/7331_Melatonin_Gummy_10mg_90ct_012125_Front_DS_1.png?v=1746047479`
- Official label asset: `https://cdn.shopify.com/s/files/1/0616/2130/5564/files/8350_MagnesiumGlycinate_Cap_200cc_240mg_Label_Front_DS.png?v=1745535588`
- Amazon store: `https://www.amazon.com/stores/NatrolLLC/page/9A003DF1-ED63-4AA1-BBE4-60E21293EC55?lp_asin=B079TD7HG2&ref_=ast_bln&store_ref=bl_ast_dp_brandLogo_sto`
- Amazon product page: `https://www.amazon.com/dp/B079TD7HG2?th=1`
- Amazon product page: `https://www.amazon.com/Natrol-Magnesium-Glycinate-Supplements-240/dp/B0DGYZGMDC`
- iHerb product page: `https://www.iherb.com/pr/natrol-melatonin-fast-dissolve-strawberry-10-mg-100-tablets/43729`
- iHerb product page: `https://www.iherb.com/pr/natrol-kids-melatonin-sleep-support-berry-berry-1-mg-90-veggie-gummies/104428`
- iHerb product page: `https://www.iherb.com/pr/natrol-high-absorption-magnesium-glycinate-60-capsules/143337`

Blocker notes:
- iHerb direct browsing/fetching hit Cloudflare security verification.
- Natrol exposed useful label/image assets, but I did not isolate product-specific PDF labels; the visible PDF I found was a generic reseller credit application and not useful for product recovery.

Recovery usefulness assessment:
- High. Natrol has broad official sitemap coverage, category depth around sleep/melatonin, and direct Amazon cross-links from the official site, which should make missing-SKU recovery comparatively efficient.
