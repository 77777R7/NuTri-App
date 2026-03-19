# North America Brand Discovery A

Date: 2026-03-17
Assigned brands: Pure Encapsulations, Sports Research, Life Extension

## Pure Encapsulations

### Sources checked
- Official consumer site: `https://www.pureencapsulations.com/`
- Official pro site / search-indexed official assets: `https://www.pureencapsulationspro.com/`
- iHerb
- Amazon

### Confirmed North America site coverage
- Evidence-backed:
  - `https://www.pureencapsulations.com/` is live and US-localized (`localization=US`, `cart_currency=USD` in live response headers).
  - Search-indexed official pro URLs exist for individual supplement products and PDF collateral.
  - Amazon search results surfaced live in browser with Pure Encapsulations supplement listings.
  - iHerb has search-indexed product pages for Pure Encapsulations supplements.
- Weak / ambiguous:
  - `https://www.pureencapsulations.com/collections/all` redirects toward a MyShopify storefront and rendered empty in direct crawl output, so it is not a reliable bulk-catalog recovery source.
  - `https://www.pureencapsulationspro.com/` returned `This site is temporarily unavailable | Nestlé` in browser and `403/Access Denied` to direct HTTP during this run, so live pro-site traversal was weak even though indexed URLs still surfaced.

### Strongest candidate URLs/assets
- Official product page: `https://www.pureencapsulationspro.com/silymarin/PE1.html`
- Official PDF catalog: `https://www.pureencapsulationspro.com/media/wysiwyg/pdf/PE_ProductsAtAGlance.pdf`
- Official PDF guide: `https://www.pureencapsulationspro.com/media/wysiwyg/pdf/PatientProductGuide.pdf`
- iHerb product page: `https://www.iherb.com/pr/pure-encapsulations-one-multivitamin-60-capsules/131611`
- iHerb product page: `https://www.iherb.com/pr/pure-encapsulations-berberine-ultrasorb-550-mg-60-capsules/138726`
- Amazon product page: `https://www.amazon.com/Pure-Encapsulations-N-Multivitamin-Hypoallergenic/dp/B00CBYG1L0/ref=sr_1_1?dib=eyJ2IjoiMSJ9.b_cSbfa9oNxyFkyeC8yIHh_XyNpX4G9ixyLmT_mhMFQSNI8FR53zPwcrCwi9NtNEQWh-XLdMuVt_UKc2xdTdL71Gxg8HNu_kjBAbVkqYfFlwdJIOgSIDhIStFDfPUMwpKra1M9pgx2b50c1jMsLZWT_bn6kYAb3Fuw8b5Dlq9bR6_rdf7q6tfWdz3McqyaUCfQYyBZI03iUSDiURw4KPsbVjFElPG95CsLvye6hjsHD-6TJWusZM5rkdn69kGxhCfKfFM9CBwKWYN0mkHwamd0CrQpEGmUVKSyJ7xjKM0Mg.t-b4R1G_7a-AdQa5FmhjeFObURygh7KSqt0igXpvxwI&dib_tag=se&keywords=Pure%2BEncapsulations&qid=1773786045&sr=8-1&th=1`

### Blocker notes
- iHerb direct HTTP search was Cloudflare-challenged (`403 Just a moment...`), so iHerb evidence here relies on search-indexed product URLs rather than live in-session catalog traversal.
- Amazon direct HTTP returned `503`; browser automation worked for search and product navigation.
- Official pro site traversal was partially blocked / temporarily unavailable during execution.

### Recovery usefulness assessment
- High for supplement recovery if we treat official PDFs plus iHerb/Amazon product pages as the primary recovery lane.
- Medium for official-site-only recovery because the consumer catalog crawl was weak and the pro site was partially blocked during live execution.

## Sports Research

### Sources checked
- Official site: `https://www.sportsresearch.com/`
- Official sitemap / product pages
- iHerb
- Amazon

### Confirmed North America site coverage
- Evidence-backed:
  - `https://www.sportsresearch.com/` is live and directly crawlable.
  - `https://www.sportsresearch.com/sitemap.xml` exposes a large first-party supplement catalog with many `/products/...` URLs.
  - Official product pages expose structured product data and Shopify CDN label/media assets in HTML.
  - Amazon search results surfaced live in browser with supplement product pages.
  - iHerb has direct Sports Research supplement product pages.
- Weak / ambiguous:
  - I did not find first-party PDF label downloads in this pass; the most useful official assets were product pages, sitemap entries, and embedded CDN label/media images.

### Strongest candidate URLs/assets
- Official sitemap: `https://www.sportsresearch.com/sitemap.xml`
- Official product page: `https://www.sportsresearch.com/products/magnesium-glycinate`
- Official product page: `https://www.sportsresearch.com/products/omega-3-fish-oil-alaskaomegar-1250mg`
- Official product page: `https://www.sportsresearch.com/products/creatine-monohydrate`
- iHerb product page: `https://www.iherb.com/pr/sports-research-omega-3-fish-oil-triple-strength-90-softgels/72025`
- iHerb product page: `https://www.iherb.com/pr/sports-research-collagen-peptides-unflavored-16-oz-454-g/75788`
- Amazon product page: `https://www.amazon.com/Sports-Research%C2%AE-Omega-3-Fish-1250/dp/B07DX89ZHN/ref=sr_1_1?dib=eyJ2IjoiMSJ9.HupngdWEzElzCpo0i-6uFZFr0JK-GxACK3MC3d3tEmZLu0BPuj6lAmqBOGpyiRE8lf_aeRZsWgLAD-wtd_q6N2kUsM_pUQeWFBt54xtcEwgytTvgPMpDMuqRVPfAIMDui5x2ZfKt4uxREYWmGNwEk8OgR2oDhLhfgPfo588TKd5u_elaCV0F7fp3uJ6-BLB-LsZXSasX92AQyBs9zYHsD91_4R6krgaAec9XUhMr2u6jpQfTnjvTbzxwGMBBcOLQLj7cWIDv0LIc7NJG-Yu0HQVufJbwrS3Vi4yRnrPm37g.4ocGqc1t5V9obZpNvXHirlaYTE82JD3iHc5MYXEsqzI&dib_tag=se&keywords=Sports%2BResearch&qid=1773786231&sr=8-1&th=1`

### Blocker notes
- Amazon direct HTTP returned anti-bot / incomplete responses, but browser automation successfully surfaced and opened product pages.
- No first-party PDF label library was confirmed in this quick pass.

### Recovery usefulness assessment
- High. Sports Research is the cleanest brand in this batch because the official sitemap is rich, product pages are directly crawlable, and iHerb/Amazon both surfaced strong supplement coverage.

## Life Extension

### Sources checked
- Official site / official search-indexed product pages and labels
- iHerb
- Amazon

### Confirmed North America site coverage
- Evidence-backed:
  - Search-indexed official Life Extension supplement product pages and label PDFs surfaced cleanly.
  - Amazon search results surfaced live in browser with Life Extension supplement product pages.
  - iHerb has direct Life Extension supplement product pages.
- Weak / ambiguous:
  - Direct HTTP to `https://www.lifeextension.com/`, `robots.txt`, and `sitemap-index.xml` returned `403 Access Denied` during this run, so official-site confirmation came from indexed product/label URLs rather than live sitemap traversal.

### Strongest candidate URLs/assets
- Official product page: `https://www.lifeextension.com/vitamins-supplements/item02314/two-per-day-tablets`
- Official label PDF: `https://www.lifeextension.com/-/media/project/le/pdfs/labels/vitamins-supplements/02314.pdf`
- Official product page: `https://www.lifeextension.com/vitamins-supplements/item01683/neuro-mag-magnesium-l-threonate-capsules`
- iHerb product page: `https://www.iherb.com/pr/life-extension-one-per-day-tablets-60-tablets/47803`
- iHerb product page: `https://www.iherb.com/pr/life-extension-super-omega-3-epa-dha-fish-oil-sesame-lignans-olive-extract-240-softgels/32174`
- Amazon product page: `https://www.amazon.com/Life-Extension-Potency-Multi-Vitamin-Supplement/dp/B07KCZ6CDW/ref=sr_1_1?dib=eyJ2IjoiMSJ9.-YV4C6JayFVYjI4XyHC4LB2kr-_4q73mFwcU6G8TCHBjUfVu0t1u9L82v34DvzFK7wv3KNHs7zkbea5Zpp0ePjLxgYOzNBmVGdgu3PPGaycLgHARWOpCmXhZGt5GTHPiFCL_YALkdr-IRBh17PGXgnktk8NIsvrKILEdtHX-GJUslq6w3p2a9t4siBz74W2KosiaGjUWp0_QpQhfI-UbyXE3g0aDzVLanFOJN75oeUr7VBnJcokM-zn4pZWo88UXoV8dqPiVaMUn2JfwA6-QtKQHNClZKMy1b2UCVRZFw5s.srszvXA65NqLBTfWSyPYENrQ3JjeMREiQqrRsjmnBQ0&dib_tag=se&keywords=Life%2BExtension&qid=1773786180&sr=8-1&th=1`

### Blocker notes
- Official Life Extension site actively blocked direct HTTP access in this run (`403 Access Denied`), including `robots.txt` and sitemap.
- Amazon direct HTTP was not dependable; browser automation was required for product-page confirmation.

### Recovery usefulness assessment
- Medium-high. Official product-page and PDF-label evidence is strong for targeted recovery of known high-frequency SKUs, but broad official-catalog expansion is weaker until the Life Extension blocking issue is bypassed more cleanly.
