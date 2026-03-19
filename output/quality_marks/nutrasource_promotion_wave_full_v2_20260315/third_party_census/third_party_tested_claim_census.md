# Week 2 NuTri Score Third-Party Tested Claim Census

Generated at: 2026-03-15T20:11:18.791Z
Staging path: /Users/howard07/NuTriApp/nutri-app/output/iherb_header_facts_week2_closure_v2_20260313/staging_products.parser_enriched.json
Merge report path: /Users/howard07/NuTriApp/nutri-app/output/iherb_overlay_bulk_merge_week2_final_unified_20260313/overlay_merge_coverage_report.json

## Scope

- matched/imported products: 26494
- decision support compile errors: 0
- quality-mark registry checked subset: 206

## Bucket Definitions

- `verified`: product-level official registry verification exists.
- `claimed`: third-party claim is present in the current NuTri Score path, but not officially product-verified.
- `brand_level_program_signal_only`: official program evidence exists only at brand level, not product level.
- `registry_blocked`: official registry check was blocked and there is no stronger claim/program evidence.
- `not_proven`: no claim/program evidence is currently proven under the latest Week 2 path.

## Bucket Counts

- verified: 104 (0.4%)
- claimed: 9833 (37.1%)
- brand_level_program_signal_only: 19 (0.1%)
- registry_blocked: 20 (0.1%)
- not_proven: 16518 (62.3%)

## Third-Party Checklist States

- missing: 15933
- verified: 9957
- unknown: 604

## Summary Status

- none: 16840
- claimed: 8891
- ambiguous: 642
- verified: 104
- not_proven: 17

## Warning Overlaps

- registry_not_checked: 8808
- program_not_equivalent_to_generic_third_party: 1222
- nutrasource_brand_detail_page: 165
- nutrasource_detail_page: 144
- registry_checked_not_found: 84
- brand_level_only_match: 48
- registry_result_ambiguous: 47
- registry_access_blocked: 20

## Samples

### verified

- Barlean's | Barlean's, Ideal Omega 3, Orange, 30 Softgels | checklist=verified | summary=verified | strongest=IFOS | warnings=none | url=https://www.iherb.com/pr/barlean-s-ideal-omega-3-orange-30-softgels/122252
- Barlean's | Barlean's, Ideal Omega 3, Orange, 60 Softgels | checklist=verified | summary=verified | strongest=IFOS | warnings=registry_result_ambiguous | url=https://www.iherb.com/pr/barlean-s-ideal-omega-3-orange-60-softgels/106163
- Barlean's | Barlean's, Plant Based Total Omega 3 · 6 · 9, Pomegranate Blueberry Smoothie, 3,980 mg, 16 oz (454 g) | checklist=verified | summary=verified | strongest=IFOS | warnings=none | url=https://www.iherb.com/pr/barlean-s-plant-based-total-omega-3-6-9-pomegranate-blueberry-smoothie-3-980-mg-16-oz-454-g/15850
- Barlean's | Barlean's, Total Omega®, Omega 3-6-9, Orange Creme, 2,400 mg, 16 oz (454 g) | checklist=verified | summary=verified | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page, nutrasource_detail_page | url=https://www.iherb.com/pr/barlean-s-total-omega-omega-3-6-9-orange-creme-2-400-mg-16-oz-454-g/23436
- C4 / Cellucor | C4 / Cellucor, C4 Sport®, Pre-Workout, Fruit Punch, 7.4 oz (210 g) | checklist=verified | summary=verified | strongest=NSF Certified for Sport | warnings=none | url=https://www.iherb.com/pr/c4-cellucor-c4-sport-pre-workout-fruit-punch-7-4-oz-210-g/81118
- C4 / Cellucor | C4 / Cellucor, C4 Sport®, Pre-Workout, Watermelon, 7.1 oz (201 g) | checklist=verified | summary=verified | strongest=NSF Certified for Sport | warnings=none | url=https://www.iherb.com/pr/c4-cellucor-c4-sport-pre-workout-watermelon-7-1-oz-201-g/81116
- Carlson | Carlson, Cod Liver Oil, Natural Green Apple , 1,100 mg, 8.4 fl oz (250 ml) | checklist=verified | summary=verified | strongest=IFOS | warnings=program_not_equivalent_to_generic_third_party | url=https://www.iherb.com/pr/carlson-cod-liver-oil-natural-green-apple-1-100-mg-8-4-fl-oz-250-ml/114553
- Carlson | Carlson, EcoSmart® DHA, Natural Lemon, 500 mg, 60 Soft Gels + 20 Soft Gels | checklist=verified | summary=verified | strongest=IFOS | warnings=registry_result_ambiguous | url=https://www.iherb.com/pr/carlson-ecosmart-dha-natural-lemon-500-mg-60-soft-gels-20-soft-gels/67751
- Carlson | Carlson, Elite DHA Gems, 1,000 mg, 30 Soft Gels | checklist=verified | summary=verified | strongest=IFOS | warnings=nutrasource_detail_page, program_not_equivalent_to_generic_third_party, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/carlson-elite-dha-gems-1-000-mg-30-soft-gels/125458
- Carlson | Carlson, Elite EPA Gems, 1,000 mg, 120 Soft Gels | checklist=verified | summary=verified | strongest=IFOS | warnings=nutrasource_detail_page, program_not_equivalent_to_generic_third_party, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/carlson-elite-epa-gems-1-000-mg-120-soft-gels/13839
- Carlson | Carlson, Elite Omega-3 Plus D & K, Natural Lemon, 60 Soft Gels | checklist=verified | summary=verified | strongest=IFOS | warnings=program_not_equivalent_to_generic_third_party | url=https://www.iherb.com/pr/carlson-elite-omega-3-plus-d-k-natural-lemon-60-soft-gels/84834
- Carlson | Carlson, Kid's Chewable DHA, Bursting Orange, 60 Soft Gels | checklist=verified | summary=verified | strongest=IFOS | warnings=program_not_equivalent_to_generic_third_party | url=https://www.iherb.com/pr/carlson-kid-s-chewable-dha-bursting-orange-60-soft-gels/125451

### claimed

- 21st Century | 21st Century, Acidophilus Probiotic Blend, 100 Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-acidophilus-probiotic-blend-100-capsules/11193
- 21st Century | 21st Century, Acidophilus Probiotic Blend, 150 Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-acidophilus-probiotic-blend-150-capsules/12535
- 21st Century | 21st Century, Acidophilus, Probiotic Blend, 300 Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-acidophilus-probiotic-blend-300-capsules/130241
- 21st Century | 21st Century, Advanced Formula Hair, Skin & Nails, 50 Tablets | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-advanced-formula-hair-skin-nails-50-tablets/14605
- 21st Century | 21st Century, Colon Cleanse, 120 Vegetarian Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-colon-cleanse-120-vegetarian-capsules/41321
- 21st Century | 21st Century, Cranberry Plus Probiotic, 60 Tablets | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-cranberry-plus-probiotic-60-tablets/69338
- 21st Century | 21st Century, Daily Greens Superfoods Powder, Lemon Lime, 7.4 oz (210 g) | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-daily-greens-superfoods-powder-lemon-lime-7-4-oz-210-g/155434
- 21st Century | 21st Century, Folic Acid, 800 mcg, 180 Easy to Swallow Tablets | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-folic-acid-800-mcg-180-easy-to-swallow-tablets/46759
- 21st Century | 21st Century, Kalos & Splendor™ Collagen Peptides, Unflavored, 10.6 oz (300 g) | checklist=verified | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-kalos-splendor-collagen-peptides-unflavored-10-6-oz-300-g/154191
- 21st Century | 21st Century, Norwegian Cod Liver Oil, 400 mg, 110 Softgels | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-norwegian-cod-liver-oil-400-mg-110-softgels/43718
- 21st Century | 21st Century, Prostate Health with Beta-Sitosterol, 60 Softgels | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/21st-century-prostate-health-with-beta-sitosterol-60-softgels/95254
- 4th & Heart | 4th & Heart, Ghee Clarified Butter, Grass Fed, Original Recipe, 16 oz (454 g) | checklist=verified | summary=claimed | strongest=NSF Certified for Sport | warnings=registry_checked_not_found | url=https://www.iherb.com/pr/4th-heart-ghee-clarified-butter-grass-fed-original-recipe-16-oz-454-g/72959

### brand_level_program_signal_only

- Barlean's | Barlean's, Fresh Catch®, Ultra EPA/DHA Fish Oil, Orange, 60 Softgels (650 mg per Softgel) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-fresh-catch-ultra-epa-dha-fish-oil-orange-60-softgels-650-mg-per-softgel/14956
- Barlean's | Barlean's, Lignan Flax Oil, 250 Softgels | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-lignan-flax-oil-250-softgels/3520
- Barlean's | Barlean's, Master Blend, Total Omega® 3 · 6 · 9, Lemonade, 16 fl oz (473 ml) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-master-blend-total-omega-3-6-9-lemonade-16-fl-oz-473-ml/9618
- Barlean's | Barlean's, Omega Twin with Flax Lignans, 12 fl oz (355 ml) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-omega-twin-with-flax-lignans-12-fl-oz-355-ml/3531
- Barlean's | Barlean's, Omega-3 From Fish Oil, Key Lime Pie, 8 oz (227 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-omega-3-from-fish-oil-key-lime-pie-8-oz-227-g/122253
- Barlean's | Barlean's, Platinum Intestinal Repair, Mixed Berry, 6.35 oz (180 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-platinum-intestinal-repair-mixed-berry-6-35-oz-180-g/73685
- Barlean's | Barlean's, Seriously Delicious, Omega-3 from Flax Oil, Blackberry Smoothie, 2,968 mg, 16 oz (454 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-3-from-flax-oil-blackberry-smoothie-2-968-mg-16-oz-454-g/27010
- Barlean's | Barlean's, Seriously Delicious® Omega Pals, Chirpin' Slurpin' Lemonade , 8 oz (227 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-pals-chirpin-slurpin-lemonade-8-oz-227-g/36567
- Barlean's | Barlean's, Seriously Delicious®, Omega-3 From Fish Oil + Vitamin D, Mango Peach Smoothie, 16 oz (454 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-3-from-fish-oil-vitamin-d-mango-peach-smoothie-16-oz-454-g/23876
- Barlean's | Barlean's, Seriously Delicious®, Omega-3 From Fish Oil, Citrus Sorbet, 16 oz (454 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-3-from-fish-oil-citrus-sorbet-16-oz-454-g/58143
- Barlean's | Barlean's, Seriously Delicious®, Omega-3 From Fish Oil, Key Lime Pie, 16 oz (454 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-3-from-fish-oil-key-lime-pie-16-oz-454-g/42624
- Barlean's | Barlean's, Seriously Delicious®, Omega-3 From Fish Oil, Lemon Creme, 16 oz (454 g) | checklist=missing | summary=not_proven | strongest=IFOS | warnings=brand_level_only_match, registry_result_ambiguous, registry_checked_not_found, nutrasource_brand_detail_page | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-omega-3-from-fish-oil-lemon-creme-16-oz-454-g/13411

### registry_blocked

- 21st Century | 21st Century, GLP-1, 60 Vegetarian Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/21st-century-glp-1-60-vegetarian-capsules/151985
- 21st Century | 21st Century, Herbal Slimming Tea, Cranraspberry, Caffeine Free, 24 Tea Bags, 1.7 oz (48 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/21st-century-herbal-slimming-tea-cranraspberry-caffeine-free-24-tea-bags-1-7-oz-48-g/13187
- 21st Century | 21st Century, Red Yeast Rice, 600 mg, 150 Vegetarian Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/21st-century-red-yeast-rice-600-mg-150-vegetarian-capsules/11501
- 21st Century | 21st Century, Resveratrol Red Wine Extract, 90 Capsules | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/21st-century-resveratrol-red-wine-extract-90-capsules/41326
- ABE | ABE, Pre-Workout, Tropical Vibes, 13.75 oz (390 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/abe-pre-workout-tropical-vibes-13-75-oz-390-g/134132
- Barlean's | Barlean's, Flax-Chia-Coconut Blend, 12 oz (340 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/barlean-s-flax-chia-coconut-blend-12-oz-340-g/58147
- Barlean's | Barlean's, Omega Pals, Essential Nutrition For Kids, Sensational Straw-Nana, 8 oz (227 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/barlean-s-omega-pals-essential-nutrition-for-kids-sensational-straw-nana-8-oz-227-g/89985
- Barlean's | Barlean's, Omega Pals, Hooty Fruity Tangerine, 8 oz (227 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous, program_not_equivalent_to_generic_third_party | url=https://www.iherb.com/pr/barlean-s-omega-pals-hooty-fruity-tangerine-8-oz-227-g/89986
- Barlean's | Barlean's, Seriously Delicious®, Plant Based Omega-3 from Flax Oil, Strawberry Banana Smoothie, 2,968 mg, 8 oz (227 g) | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/barlean-s-seriously-delicious-plant-based-omega-3-from-flax-oil-strawberry-banana-smoothie-2-968-mg-8-oz-227-g/122257
- Carlson | Carlson, E-Gems® Plus, 100 Soft Gels | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/carlson-e-gems-plus-100-soft-gels/125514
- Carlson | Carlson, E-Gems® Plus, 140 Soft Gels | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/carlson-e-gems-plus-140-soft-gels/125516
- Carlson | Carlson, E-Gems® Plus, 250 Soft Gels | checklist=verified | summary=claimed | strongest=USP Verified | warnings=registry_access_blocked, registry_result_ambiguous | url=https://www.iherb.com/pr/carlson-e-gems-plus-250-soft-gels/125515

### not_proven

- 21st Century | 21st Century, 600 + D3 Plus Minerals, Fruit Punch, 75 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-600-d3-plus-minerals-fruit-punch-75-tablets/41312
- 21st Century | 21st Century, 600+D3 Plus Minerals, 120 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-600-d3-plus-minerals-120-tablets/52830
- 21st Century | 21st Century, 600+D3, Calcium & Vitamin D3 Supplement, 400 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-600-d3-calcium-vitamin-d3-supplement-400-tablets/55898
- 21st Century | 21st Century, 600+D3, Calcium & Vitamin D3 Supplement, 75 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-600-d3-calcium-vitamin-d3-supplement-75-tablets/55896
- 21st Century | 21st Century, Alaska Wild Fish Oil, Mega Omega 3, 90 Enteric Coated Softgels | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-alaska-wild-fish-oil-mega-omega-3-90-enteric-coated-softgels/15223
- 21st Century | 21st Century, Alpha Lipoic Acid, 200 mg, 60 Vegetarian Capsules | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-alpha-lipoic-acid-200-mg-60-vegetarian-capsules/115010
- 21st Century | 21st Century, Antioxidant, 75 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-antioxidant-75-tablets/43825
- 21st Century | 21st Century, Apple Cider Vinegar, 300 mg, 250 Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-apple-cider-vinegar-300-mg-250-tablets/10450
- 21st Century | 21st Century, Apple Cider Vinegar, 90 Capsules | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-apple-cider-vinegar-90-capsules/115006
- 21st Century | 21st Century, Arthri-Flex Advantage® + Vitamin D3, 120 Coated Tablets | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-arthri-flex-advantage-vitamin-d3-120-coated-tablets/37348
- 21st Century | 21st Century, Arthri-Flex® Advantage + Turmeric, 90 Vegetarian Capsules | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-arthri-flex-advantage-turmeric-90-vegetarian-capsules/120057
- 21st Century | 21st Century, Ashwagandha Extract, Standardized, 60 Vegetarian Capsules (500 mg per Capsule) | checklist=missing | summary=none | strongest=none | warnings=none | url=https://www.iherb.com/pr/21st-century-ashwagandha-extract-standardized-60-vegetarian-capsules-500-mg-per-capsule/115013

