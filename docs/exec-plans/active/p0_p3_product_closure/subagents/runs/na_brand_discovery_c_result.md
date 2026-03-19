## na-brand-discovery-c

Status: completed_with_known_iherb_blockers

Method:
- Used live official-site sitemap and Shopify product JSON checks for concrete catalog, barcode, and image-asset evidence.
- Used browser automation against iHerb and Amazon search surfaces to verify whether pages were directly usable from this environment.
- Used live Amazon search HTML extraction when browser DOM output was too thin to enumerate product links cleanly.

### Schiff

Sources checked:
- Official: `https://www.schiffvitamins.com/`, `https://www.schiffvitamins.com/sitemap.xml`, product and collection sitemaps, Shopify `.js` product endpoints.
- Amazon: `https://www.amazon.com/s?k=Schiff+vitamins` plus extracted `/dp/` product links.
- iHerb: `https://www.iherb.com/search?kw=Schiff`, `https://www.iherb.com/c/schiff`.

Confirmed North America site coverage:
- Official site is strong and recovery-useful. The product sitemap exposes `47` product pages and the collection sitemap exposes `47` collections across Schiff, Move Free, MegaRed, Airborne, and Digestive Advantage.
- Strong official recovery URLs/assets:
  - `https://www.schiffvitamins.com/collections/move-free`
  - `https://www.schiffvitamins.com/collections/megared`
  - `https://www.schiffvitamins.com/collections/airborne`
  - `https://www.schiffvitamins.com/products/move-free-ultra-triple-action-typeiicollagen`
  - `https://www.schiffvitamins.com/products/move-free-ultra-triple-action-typeiicollagen.js`
- Strongest candidate URLs/assets:
  - `https://www.schiffvitamins.com/products/megared-advanced-4in1-900mg-40ct`
  - `https://www.schiffvitamins.com/products/megared-advanced-4in1-900mg-40ct.js`
  - `https://cdn.shopify.com/s/files/1/1308/7983/products/Supplementalfacts_23c6a42b-390f-4aad-a04c-7c02b1e8e1e0.png?v=1678309569`
  - `https://www.schiffvitamins.com/products/airborne-citrus-chewable-tablets`
  - `https://cdn.shopify.com/s/files/1/1308/7983/files/7.suppfacts_805ba377-6866-4000-87b7-9ce32d06f5ea.png?v=1726482484`
- Barcode/SKU evidence already available from official `.js` endpoints:
  - Move Free 3X Ultra Triple Action: `020525118417` (`30ct`), `020525956033` (`60ct`)
  - MegaRed Advanced 4in1 900mg 40ct: `020525963994`
  - Airborne Chewable Tablets Citrus: `647865203346` (`32ct`), `647865962977` (`96ct`)
- Amazon evidence is usable but mixed because the search result set includes Schiff and non-Schiff joint-support competitors:
  - `https://www.amazon.com/Move-Free-Advanced-Plus-tablets/dp/B001W2MBSE`
  - `https://www.amazon.com/Collagen-Move-Free-Supplement-Cartilage/dp/B07VLJN7C6`
  - `https://www.amazon.com/MegaRed-Softgels-Aftertaste-Antioxidant-Astaxanthin/dp/B01070FUDE`

Blocker notes:
- iHerb is blocked from this environment. Browser automation reached a Cloudflare security-verification page, and direct `curl -I` checks on both the search and brand URLs returned `HTTP/2 403` with `cf-mitigated: challenge`.
- Amazon browser automation loaded the page title but returned a very thin DOM snapshot, so product extraction had to fall back to raw search HTML parsing.

Recovery usefulness assessment:
- High. Official Schiff coverage is not massive, but it is structured well and exposes barcodes plus label/supplement-facts images for high-value Move Free, MegaRed, and Airborne products. Amazon helps fill naming variants, while iHerb is currently a blocker.

### Nutricost

Sources checked:
- Official: `https://nutricost.com/`, `https://nutricost.com/sitemap.xml`, product and collection sitemaps, Shopify `.js` product endpoints.
- Amazon: `https://www.amazon.com/s?k=Nutricost` plus extracted `/dp/` product links.
- iHerb: `https://www.iherb.com/search?kw=Nutricost`, `https://www.iherb.com/c/nutricost`.

Confirmed North America site coverage:
- Official site is very strong. The product sitemap exposes `726` product pages and the collection sitemap exposes `79` collections.
- Strong official recovery URLs/assets:
  - `https://nutricost.com/collections/all-items`
  - `https://nutricost.com/collections/supplements`
  - `https://nutricost.com/products/nutricost-creatine-monohydrate-powder-500-grams`
  - `https://nutricost.com/products/nutricost-creatine-monohydrate-powder-500-grams.js`
  - `https://nutricost.com/products/nutricost-whey-protein-isolate-powder-5-lbs.js`
- Strongest candidate URLs/assets:
  - `https://cdn.shopify.com/s/files/1/0222/4128/0074/files/NTC_CreatineMonohydrate_Unflavored_500G_SFP_SQUARE_72b4208e-51d7-42f8-8147-d2502f9c3035.jpg?v=1760650358`
  - `https://cdn.shopify.com/s/files/1/0222/4128/0074/files/NCW_CreatineMonohydrateUF_300GM_20OZ_SFP_Square.jpg?v=1770155682`
  - `https://www.amazon.com/Nutricost-Creatine-Monohydrate-Micronized-Powder/dp/B00GL2HMES`
  - `https://www.amazon.com/Nutricost-Ashwagandha-Herbal-Supplement-Capsules/dp/B073DN2YG9`
  - `https://www.amazon.com/Nutricost-Whey-Protein-Concentrate-Vanilla/dp/B01KITQEPM`
- Barcode/SKU evidence already available from official `.js` endpoints:
  - Creatine Monohydrate Powder: `810139571865` (`300 GMS`), `810139571629` (`500 GMS`), `810014675312` (`1 KG`)
  - Whey Protein Isolate: `702669933001` (`Chocolate / 2 lbs`), `702669932882` (`Chocolate / 5 lbs`), `702669933025` (`Unflavored / 2 lbs`), `702669932905` (`Unflavored / 5 lbs`)

Blocker notes:
- iHerb is blocked from this environment. Both search and brand-page checks returned `HTTP/2 403` and `cf-mitigated: challenge`.
- I did not get direct, evidence-backed Nutricost iHerb product URLs before stopping, so Nutricost-on-iHerb remains a weak surface here.

Recovery usefulness assessment:
- Very high. Nutricost official coverage is broad and machine-friendly, with hundreds of product handles plus official barcodes and supplement-facts images directly recoverable from Shopify JSON endpoints.

### Vital Proteins

Sources checked:
- Official: `https://www.vitalproteins.com/`, `https://www.vitalproteins.com/sitemap.xml`, product and collection sitemaps, Shopify `.js` product endpoints.
- Amazon: `https://www.amazon.com/s?k=Vital+Proteins` plus extracted `/dp/` product links.
- iHerb: `https://www.iherb.com/search?kw=Vital%20Proteins`, `https://www.iherb.com/c/vital-proteins`.

Confirmed North America site coverage:
- Official site is confirmed and useful. The product sitemap exposes `36` product pages and the collection sitemap exposes `70` collections.
- Additional NA official signal: Bing RSS surfaced `https://vitalproteins.ca/` as the Canadian official site.
- Strong official recovery URLs/assets:
  - `https://www.vitalproteins.com/collections/collagen`
  - `https://www.vitalproteins.com/collections/vital-supplements`
  - `https://www.vitalproteins.com/products/collagen-peptides`
  - `https://www.vitalproteins.com/products/collagen-peptides.js`
  - `https://www.vitalproteins.com/products/marine-collagen-peptides.js`
- Strongest candidate URLs/assets:
  - `https://cdn.shopify.com/s/files/1/2074/9385/files/4_SPF_CPAdvanced10oz.jpg?v=1762272485`
  - `https://www.amazon.com/Vital-Proteins-Pasture-Raised-Grass-Fed-Collagen/dp/B01INKB54I`
  - `https://www.amazon.com/Vital-Proteins-Nutrition-Collagen-Peptides/dp/B083LDJNPK`
  - `https://www.amazon.com/Vital-Proteins-Collagen-Peptides-Ounce/dp/B06XRC3B6M`
  - `https://vitalproteins.ca/`
- Barcode/SKU evidence already available from official `.js` endpoints:
  - Collagen Peptides Advanced: `850008654831` (`9.33oz with HA + Vitamin C`), `850008654497` (`20oz with HA + Vitamin C`)
  - Marine Collagen: `850232005485` (`7.8 oz`), `850232005409` (`Stick Pack Box 20 ct`), `850502008512` (`14.5 oz`)

Blocker notes:
- iHerb is blocked from this environment. Browser automation and direct requests both hit Cloudflare verification/challenge pages.
- I do not have direct Vital Proteins iHerb product URLs in hand, so iHerb remains weak despite likely retail presence.

Recovery usefulness assessment:
- High. Official Vital Proteins coverage is smaller than Nutricost but clean and barcode-rich, and Amazon has strong collagen-page coverage. iHerb is the only meaningful blocker.

### Country Life

Sources checked:
- Official: `https://countrylifevitamins.com/`, `https://countrylifevitamins.com/sitemap.xml`, product and collection sitemaps, Shopify `.js` product endpoints.
- Amazon: `https://www.amazon.com/s?k=Country+Life+vitamins` plus extracted `/dp/` product links.
- iHerb: `https://www.iherb.com/search?kw=Country%20Life`, `https://www.iherb.com/c/country-life`.

Confirmed North America site coverage:
- Official site is strong. The product sitemap exposes `252` product pages and the collection sitemap exposes `69` collections.
- Strong official recovery URLs/assets:
  - `https://countrylifevitamins.com/collections/amino-acids`
  - `https://countrylifevitamins.com/products/core-daily-1-for-men`
  - `https://countrylifevitamins.com/products/core-daily-1-for-men.js`
  - `https://countrylifevitamins.com/products/maxi-hair.js`
  - `https://countrylifevitamins.com/products/coenzyme-b-complex-advanced.js`
- Strongest candidate URLs/assets:
  - `https://cdn.shopify.com/s/files/1/0582/0327/5306/files/8190_SF-BOX-copy.jpg?v=1708563430`
  - `https://cdn.shopify.com/s/files/1/0582/0327/5306/files/5028_SF-BOX-copy.jpg?v=1708562819`
  - `https://www.amazon.com/Country-Life-Daily-Total-Multi-Vitamin/dp/B00117YLUQ`
  - `https://www.amazon.com/Country-Life-Core-Daily-1-Supplement/dp/B005AYL3HA`
  - `https://cdn.shopify.com/s/files/1/0582/0327/5306/files/money-back-rebate_462125a1-3c50-4a6a-94a9-7560f0006e0d.pdf`
- Barcode/SKU evidence already available from official `.js` endpoints:
  - Core Daily-1 for Men: `015794081906`
  - Maxi-Hair: `015794050285` (`60 Tablets`), `015794050292` (`90 Tablets`)
  - Coenzyme B-Complex Advanced: `015794064022` (`60 Capsules`), `015794064039` (`120 Capsules`)

Blocker notes:
- iHerb is blocked from this environment. Search and brand-page checks returned `HTTP/2 403` with `cf-mitigated: challenge`.
- Search-engine discovery for Country Life is noisy because the brand name overlaps with generic `country life` phrases, so the official site is much more reliable than third-party search discovery here.

Recovery usefulness assessment:
- High. Country Life official coverage is broad and barcode-rich, with multiple strong multivitamin and hair/beauty recovery candidates plus a useful official PDF artifact. Amazon coverage is also solid. iHerb remains blocked.

Net call:
- Best official recovery surface: `Nutricost`, then `Country Life`.
- Best official + Amazon combined surface: `Vital Proteins`.
- Best sub-brand recovery surface despite smaller catalog: `Schiff`.
- Main blocker across all four brands: iHerb Cloudflare/security challenge from this environment, preventing evidence-backed product URL extraction there.
