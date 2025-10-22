-- Seed data for brands, ingredients, supplements, and supplement ingredients.

insert into public.brands (name, country, website, logo_url, verified)
values
  ('Pure Encapsulations', 'United States', 'https://www.pureencapsulations.com', 'https://images.nutri.app/brands/pure-encapsulations.png', true),
  ('Thorne', 'United States', 'https://www.thorne.com', 'https://images.nutri.app/brands/thorne.png', true),
  ('Sports Research', 'United States', 'https://www.sportsresearch.com', 'https://images.nutri.app/brands/sports-research.png', true),
  ('Life Extension', 'United States', 'https://www.lifeextension.com', 'https://images.nutri.app/brands/life-extension.png', true),
  ('Jamieson', 'Canada', 'https://www.jamiesonvitamins.com', 'https://images.nutri.app/brands/jamieson.png', true)
on conflict (name) do update
set
  country = excluded.country,
  website = excluded.website,
  logo_url = excluded.logo_url,
  verified = excluded.verified,
  updated_at = timezone('utc', now());

with ingredient_data (name, scientific_name, rda_adult, ul_adult, unit, benefits, risks, dietary_sources) as (
  values
    ('Vitamin C', 'Ascorbic Acid', 90, 2000, 'mg', 'Supports immune function and antioxidant protection.', 'High doses may cause gastrointestinal discomfort.', 'Citrus fruits, bell peppers, broccoli.'),
    ('Vitamin D3', 'Cholecalciferol', 20, 100, 'mcg', 'Supports bone health and immune regulation.', 'Excess may elevate calcium levels and cause weakness.', 'Sunlight exposure, fortified dairy, fatty fish.'),
    ('Vitamin K2', 'Menaquinone-7', 120, 500, 'mcg', 'Helps regulate calcium deposition in bones and arteries.', 'Potential interaction with anticoagulants.', 'Fermented foods, natto, cheese.'),
    ('Vitamin B12', 'Methylcobalamin', 2.4, 5000, 'mcg', 'Supports red blood cell formation and energy metabolism.', 'Generally well tolerated; excess rarely causes side effects.', 'Animal products, fortified cereals.'),
    ('Folate', 'L-5-Methyltetrahydrofolate', 400, 1000, 'mcg', 'Supports DNA synthesis and prenatal health.', 'High intake may mask B12 deficiency.', 'Leafy greens, legumes, fortified grains.'),
    ('Magnesium', 'Magnesium Bisglycinate', 420, 350, 'mg', 'Supports muscle relaxation and energy production.', 'High doses may cause loose stools.', 'Leafy greens, nuts, seeds.'),
    ('Zinc', 'Zinc Picolinate', 11, 40, 'mg', 'Supports immune health and wound healing.', 'Excess may cause nausea and interfere with copper absorption.', 'Shellfish, meat, legumes.'),
    ('Omega-3 EPA', 'Eicosapentaenoic Acid', 250, 3000, 'mg', 'Supports cardiovascular health and anti-inflammatory balance.', 'High doses may thin blood.', 'Fatty fish, algae oils.'),
    ('Omega-3 DHA', 'Docosahexaenoic Acid', 250, 3000, 'mg', 'Supports brain and eye health.', 'High doses may thin blood.', 'Fatty fish, algae oils.'),
    ('CoQ10', 'Ubiquinol', 100, 1200, 'mg', 'Supports mitochondrial energy production.', 'May cause mild insomnia in high doses.', 'Organ meats, fatty fish.'),
    ('Curcumin', 'Curcuma Longa Extract', 1000, 4000, 'mg', 'Supports inflammatory balance and joint health.', 'High doses may cause digestive upset.', 'Turmeric spice.'),
    ('Ashwagandha', 'Withania Somnifera', 600, 1000, 'mg', 'Supports stress resilience and cortisol balance.', 'May cause mild drowsiness in sensitive individuals.', 'Ayurvedic root, supplements.'),
    ('Probiotic Blend', 'Lactobacillus & Bifidobacterium', 10000000000, null, 'CFU', 'Supports gut microbiome balance.', 'May cause temporary bloating.', 'Fermented foods, yogurt, kefir.'),
    ('Collagen Peptides', 'Hydrolyzed Collagen', 10000, null, 'mg', 'Supports joint comfort, skin hydration, and nail strength.', 'Generally well tolerated.', 'Bone broth, connective tissues.'),
    ('Biotin', 'Vitamin B7', 30, null, 'mcg', 'Supports hair, skin, and nail health.', 'Very high doses may interfere with lab tests.', 'Egg yolks, legumes, seeds.'),
    ('MCT Oil', 'Medium-Chain Triglycerides', 7000, 20000, 'mg', 'Provides quick energy and supports ketone production.', 'High doses may cause digestive discomfort.', 'Coconut oil, palm kernel oil.'),
    ('L-Theanine', 'Gamma-Glutamylethylamide', 200, 1200, 'mg', 'Promotes calm focus and alpha brain wave activity.', 'May cause mild headache in large amounts.', 'Green tea, supplements.'),
    ('Melatonin', 'N-Acetyl-5-Methoxytryptamine', 1, 10, 'mg', 'Supports sleep onset and circadian rhythm.', 'May cause grogginess or vivid dreams.', 'Produced endogenously; trace amounts in cherries.'),
    ('Calcium', 'Calcium Citrate', 1200, 2500, 'mg', 'Supports bone density and neuromuscular function.', 'High doses may increase kidney stone risk.', 'Dairy products, leafy greens.'),
    ('Iron', 'Iron Bisglycinate', 18, 45, 'mg', 'Supports oxygen transport and energy metabolism.', 'Excess may cause gastrointestinal upset.', 'Red meat, legumes, spinach.')
)
insert into public.ingredients (name, scientific_name, rda_adult, ul_adult, unit, benefits, risks, dietary_sources)
select
  name,
  scientific_name,
  rda_adult,
  ul_adult,
  unit,
  benefits,
  risks,
  dietary_sources
from ingredient_data
on conflict (name) do update
set
  scientific_name = excluded.scientific_name,
  rda_adult = excluded.rda_adult,
  ul_adult = excluded.ul_adult,
  unit = excluded.unit,
  benefits = excluded.benefits,
  risks = excluded.risks,
  dietary_sources = excluded.dietary_sources,
  updated_at = timezone('utc', now());

with supplement_data (brand_name, name, barcode, category, image_url, description, verified) as (
  values
    ('Pure Encapsulations', 'Pure Encapsulations Polyphenol Nutrients', '0850001234012', 'Multivitamin', 'https://images.nutri.app/supplements/pure-polyphenol-nutrients.jpg', 'Broad-spectrum antioxidant multivitamin with plant polyphenols.', true),
    ('Pure Encapsulations', 'Pure Encapsulations One Multivitamin', '0850001234013', 'Multivitamin', 'https://images.nutri.app/supplements/pure-one-multivitamin.jpg', 'Once-daily comprehensive micronutrient formula.', true),
    ('Pure Encapsulations', 'Pure Encapsulations Nutrient 950 with K', '0850001234014', 'Multivitamin', 'https://images.nutri.app/supplements/pure-nutrient-950.jpg', 'High-potency vitamin and mineral blend with vitamin K and co-factors.', true),
    ('Pure Encapsulations', 'Pure Encapsulations OmegaGenics EPA-DHA', '0850001234015', 'Omega-3', 'https://images.nutri.app/supplements/pure-omegagenics-epa-dha.jpg', 'Triglyceride-form EPA/DHA fish oil concentrate for cardiovascular support.', true),
    ('Pure Encapsulations', 'Pure Encapsulations Magnesium Glycinate', '0850001234016', 'Mineral', 'https://images.nutri.app/supplements/pure-magnesium-glycinate.jpg', 'Chelated magnesium for muscle relaxation and calm focus.', true),
    ('Pure Encapsulations', 'Pure Encapsulations B-Complex Plus', '0850001234017', 'B-Complex', 'https://images.nutri.app/supplements/pure-b-complex-plus.jpg', 'Balanced blend of activated B vitamins for energy metabolism.', true),
    ('Pure Encapsulations', 'Pure Encapsulations Adrenal Support', '0850001234018', 'Adaptogen', 'https://images.nutri.app/supplements/pure-adrenal-support.jpg', 'Botanical and nutrient blend to support healthy stress response.', false),
    ('Pure Encapsulations', 'Pure Encapsulations Calcium MCHA', '0850001234019', 'Mineral', 'https://images.nutri.app/supplements/pure-calcium-mcha.jpg', 'Microcrystalline hydroxyapatite providing bioavailable calcium.', true),
    ('Pure Encapsulations', 'Pure Encapsulations Digestive Enzymes Ultra', '0850001234020', 'Digestive', 'https://images.nutri.app/supplements/pure-digestive-enzymes.jpg', 'Plant-based enzyme blend to aid macronutrient breakdown.', false),
    ('Pure Encapsulations', 'Pure Encapsulations Mens Nutrients', '0850001234021', 'Multivitamin', 'https://images.nutri.app/supplements/pure-mens-nutrients.jpg', 'Targeted micronutrients and botanicals for men over 40.', true),
    ('Thorne', 'Thorne Basic Nutrients 2-Day', '0810005678001', 'Multivitamin', 'https://images.nutri.app/supplements/thorne-basic-nutrients.jpg', 'Two-capsule-per-day comprehensive micronutrient formula.', true),
    ('Thorne', 'Thorne Bio-B12', '0810005678002', 'B-Complex', 'https://images.nutri.app/supplements/thorne-bio-b12.jpg', 'Methylated B12 lozenge for active energy support.', true),
    ('Thorne', 'Thorne FloraMend Prime Probiotic', '0810005678003', 'Probiotic', 'https://images.nutri.app/supplements/thorne-floramend.jpg', 'Shelf-stable probiotic blend for digestive and immune health.', true),
    ('Thorne', 'Thorne Meriva 500-SF', '0810005678004', 'Herbal', 'https://images.nutri.app/supplements/thorne-meriva.jpg', 'Curcumin phytosome for enhanced absorption and joint support.', true),
    ('Thorne', 'Thorne Zinc Picolinate', '0810005678005', 'Mineral', 'https://images.nutri.app/supplements/thorne-zinc-picolinate.jpg', 'Highly absorbable zinc for immune and skin health.', true),
    ('Thorne', 'Thorne Vitamin D K2 Liquid', '0810005678006', 'Vitamin', 'https://images.nutri.app/supplements/thorne-d-k2.jpg', 'Liquid vitamin D3 with K2 for bone and cardiovascular support.', true),
    ('Thorne', 'Thorne Magnesium Biglycinate', '0810005678007', 'Mineral', 'https://images.nutri.app/supplements/thorne-magnesium-biglycinate.jpg', 'Buffered magnesium biglycinate for relaxation and recovery.', true),
    ('Thorne', 'Thorne NAC', '0810005678008', 'Amino Acid', 'https://images.nutri.app/supplements/thorne-nac.jpg', 'N-acetylcysteine supporting detoxification pathways.', false),
    ('Thorne', 'Thorne Curcumin Phytosome', '0810005678009', 'Herbal', 'https://images.nutri.app/supplements/thorne-curcumin-phytosome.jpg', 'Highly bioavailable curcumin complex for inflammatory balance.', true),
    ('Thorne', 'Thorne Daily Greens Plus', '0810005678010', 'Greens', 'https://images.nutri.app/supplements/thorne-daily-greens.jpg', 'Powdered greens with adaptogens and immune-supportive nutrients.', false),
    ('Sports Research', 'Sports Research Omega-3 Fish Oil', '0840002221001', 'Omega-3', 'https://images.nutri.app/supplements/sr-omega3.jpg', 'Wild-caught triglyceride-form omega-3 concentrate.', true),
    ('Sports Research', 'Sports Research Collagen Peptides', '0840002221002', 'Collagen', 'https://images.nutri.app/supplements/sr-collagen-peptides.jpg', 'Grass-fed collagen peptides for joints, hair, and nails.', true),
    ('Sports Research', 'Sports Research Turmeric Curcumin', '0840002221003', 'Herbal', 'https://images.nutri.app/supplements/sr-turmeric-curcumin.jpg', 'Turmeric extract with BioPerine for improved absorption.', true),
    ('Sports Research', 'Sports Research Vitamin D3', '0840002221004', 'Vitamin', 'https://images.nutri.app/supplements/sr-vitamin-d3.jpg', 'Vegan lichen-derived vitamin D3 softgels.', true),
    ('Sports Research', 'Sports Research Biotin', '0840002221005', 'Vitamin', 'https://images.nutri.app/supplements/sr-biotin.jpg', 'High-potency biotin to support hair and nail strength.', false),
    ('Sports Research', 'Sports Research K2 D3', '0840002221006', 'Vitamin', 'https://images.nutri.app/supplements/sr-k2-d3.jpg', 'K2 MK-7 plus D3 for calcium utilization and bone health.', true),
    ('Sports Research', 'Sports Research L-Theanine', '0840002221007', 'Amino Acid', 'https://images.nutri.app/supplements/sr-l-theanine.jpg', 'Pure L-Theanine to promote calm focus without drowsiness.', false),
    ('Sports Research', 'Sports Research Ashwagandha', '0840002221008', 'Adaptogen', 'https://images.nutri.app/supplements/sr-ashwagandha.jpg', 'KSM-66 Ashwagandha for stress resilience.', true),
    ('Sports Research', 'Sports Research MCT Oil', '0840002221009', 'Functional Food', 'https://images.nutri.app/supplements/sr-mct-oil.jpg', 'Non-GMO coconut-derived MCT oil for fast energy.', false),
    ('Sports Research', 'Sports Research Multi-Collagen', '0840002221010', 'Collagen', 'https://images.nutri.app/supplements/sr-multi-collagen.jpg', 'Five-type collagen complex with vitamin C and hyaluronic acid.', false),
    ('Life Extension', 'Life Extension Two-Per-Day Capsules', '0740007772001', 'Multivitamin', 'https://images.nutri.app/supplements/le-two-per-day.jpg', 'High-potency two-per-day multi with bioavailable nutrients.', true),
    ('Life Extension', 'Life Extension Super Omega-3', '0740007772002', 'Omega-3', 'https://images.nutri.app/supplements/le-super-omega3.jpg', 'Fish oil with olive polyphenols and sesame lignans.', true),
    ('Life Extension', 'Life Extension Magnesium L-Threonate', '0740007772003', 'Mineral', 'https://images.nutri.app/supplements/le-magnesium-l-threonate.jpg', 'Magnesium for cognitive support and synaptic density.', true),
    ('Life Extension', 'Life Extension Vitamin D3 5000 IU', '0740007772004', 'Vitamin', 'https://images.nutri.app/supplements/le-vitamin-d3.jpg', 'High-potency vitamin D3 softgel for immune and bone health.', true),
    ('Life Extension', 'Life Extension Super Ubiquinol CoQ10', '0740007772005', 'Antioxidant', 'https://images.nutri.app/supplements/le-coq10.jpg', 'Enhanced-absorption ubiquinol for mitochondrial energy.', true),
    ('Life Extension', 'Life Extension Ultra Prostate Formula', '0740007772006', 'Men''s Health', 'https://images.nutri.app/supplements/le-ultra-prostate.jpg', 'Botanical blend to support prostate and urinary health.', false),
    ('Life Extension', 'Life Extension Neuro-Mag', '0740007772007', 'Cognitive', 'https://images.nutri.app/supplements/le-neuro-mag.jpg', 'Magnesium L-threonate formula for brain performance.', true),
    ('Life Extension', 'Life Extension NAD+ Cell Regenerator', '0740007772008', 'Longevity', 'https://images.nutri.app/supplements/le-nad-cell-regenerator.jpg', 'NIAGEN nicotinamide riboside to support healthy aging.', true),
    ('Life Extension', 'Life Extension Mix Tablets', '0740007772009', 'Multivitamin', 'https://images.nutri.app/supplements/le-mix-tablets.jpg', 'Comprehensive phytonutrient multi with plant extracts.', false),
    ('Life Extension', 'Life Extension Wellness Code Whey', '0740007772010', 'Protein', 'https://images.nutri.app/supplements/le-wellness-code-whey.jpg', 'Grass-fed whey protein with added glutamine.', false),
    ('Jamieson', 'Jamieson Vitamin C Chewable', '0630005553001', 'Vitamin', 'https://images.nutri.app/supplements/jamieson-vitamin-c.jpg', 'Chewable vitamin C with natural orange flavor.', true),
    ('Jamieson', 'Jamieson Vitamin D3 1000 IU', '0630005553002', 'Vitamin', 'https://images.nutri.app/supplements/jamieson-vitamin-d3.jpg', 'Daily vitamin D3 softgel for immune support.', true),
    ('Jamieson', 'Jamieson Omega-3 Select', '0630005553003', 'Omega-3', 'https://images.nutri.app/supplements/jamieson-omega3.jpg', 'Enteric-coated omega-3 concentrate with no fishy aftertaste.', true),
    ('Jamieson', 'Jamieson Probiotic 10 Billion', '0630005553004', 'Probiotic', 'https://images.nutri.app/supplements/jamieson-probiotic.jpg', '10 strain probiotic for digestive and immune support.', false),
    ('Jamieson', 'Jamieson Zinc 50 mg', '0630005553005', 'Mineral', 'https://images.nutri.app/supplements/jamieson-zinc.jpg', 'High-potency zinc for immune defense.', false),
    ('Jamieson', 'Jamieson Melatonin 5 mg', '0630005553006', 'Sleep', 'https://images.nutri.app/supplements/jamieson-melatonin.jpg', 'Time-release melatonin to support restful sleep.', true),
    ('Jamieson', 'Jamieson Collagen Anti-Wrinkle', '0630005553007', 'Collagen', 'https://images.nutri.app/supplements/jamieson-collagen.jpg', 'Collagen with vitamin C and biotin for skin elasticity.', false),
    ('Jamieson', 'Jamieson Multivitamin for Women', '0630005553008', 'Multivitamin', 'https://images.nutri.app/supplements/jamieson-multi-women.jpg', 'Multivitamin tailored to women''s energy and bone needs.', true),
    ('Jamieson', 'Jamieson Vitamin B12 Energy Spray', '0630005553009', 'Vitamin', 'https://images.nutri.app/supplements/jamieson-b12-spray.jpg', 'Quick-dissolve B12 spray for convenient energy support.', false),
    ('Jamieson', 'Jamieson Calcium Magnesium with Vitamin D3', '0630005553010', 'Mineral', 'https://images.nutri.app/supplements/jamieson-calcium-magnesium.jpg', 'Balanced calcium and magnesium with D3 for bone strength.', true)
)
insert into public.supplements (brand_id, name, barcode, category, image_url, description, verified)
select
  b.id,
  sd.name,
  sd.barcode,
  sd.category,
  sd.image_url,
  sd.description,
  sd.verified
from supplement_data sd
join public.brands b on b.name = sd.brand_name
on conflict (brand_id, name) do update
set
  barcode = excluded.barcode,
  category = excluded.category,
  image_url = excluded.image_url,
  description = excluded.description,
  verified = excluded.verified,
  updated_at = timezone('utc', now());

with link_data (supplement_name, ingredient_name, amount, unit, daily_value_percentage) as (
  values
    ('Pure Encapsulations Polyphenol Nutrients', 'Vitamin C', 250, 'mg', 278.0),
    ('Pure Encapsulations Polyphenol Nutrients', 'Vitamin D3', 25, 'mcg', 125.0),
    ('Pure Encapsulations Polyphenol Nutrients', 'Folate', 800, 'mcg', 200.0),
    ('Pure Encapsulations One Multivitamin', 'Vitamin C', 200, 'mg', 222.0),
    ('Pure Encapsulations One Multivitamin', 'Vitamin B12', 500, 'mcg', 20833.0),
    ('Pure Encapsulations One Multivitamin', 'Magnesium', 120, 'mg', 29.0),
    ('Pure Encapsulations Nutrient 950 with K', 'Vitamin K2', 120, 'mcg', 100.0),
    ('Pure Encapsulations Nutrient 950 with K', 'Vitamin D3', 50, 'mcg', 250.0),
    ('Pure Encapsulations Nutrient 950 with K', 'Calcium', 200, 'mg', 17.0),
    ('Pure Encapsulations OmegaGenics EPA-DHA', 'Omega-3 EPA', 700, 'mg', 280.0),
    ('Pure Encapsulations OmegaGenics EPA-DHA', 'Omega-3 DHA', 500, 'mg', 200.0),
    ('Pure Encapsulations OmegaGenics EPA-DHA', 'CoQ10', 50, 'mg', 50.0),
    ('Pure Encapsulations Magnesium Glycinate', 'Magnesium', 200, 'mg', 48.0),
    ('Pure Encapsulations B-Complex Plus', 'Vitamin B12', 400, 'mcg', 16667.0),
    ('Pure Encapsulations B-Complex Plus', 'Folate', 600, 'mcg', 150.0),
    ('Pure Encapsulations Adrenal Support', 'Ashwagandha', 400, 'mg', null),
    ('Pure Encapsulations Adrenal Support', 'Vitamin C', 120, 'mg', 133.0),
    ('Pure Encapsulations Calcium MCHA', 'Calcium', 500, 'mg', 42.0),
    ('Pure Encapsulations Calcium MCHA', 'Vitamin D3', 20, 'mcg', 100.0),
    ('Pure Encapsulations Digestive Enzymes Ultra', 'Probiotic Blend', 5000000000, 'CFU', null),
    ('Pure Encapsulations Mens Nutrients', 'Vitamin D3', 25, 'mcg', 125.0),
    ('Pure Encapsulations Mens Nutrients', 'Zinc', 30, 'mg', 273.0),
    ('Thorne Basic Nutrients 2-Day', 'Vitamin C', 180, 'mg', 200.0),
    ('Thorne Basic Nutrients 2-Day', 'Vitamin D3', 37.5, 'mcg', 188.0),
    ('Thorne Basic Nutrients 2-Day', 'Magnesium', 140, 'mg', 33.0),
    ('Thorne Bio-B12', 'Vitamin B12', 1000, 'mcg', 41667.0),
    ('Thorne FloraMend Prime Probiotic', 'Probiotic Blend', 12000000000, 'CFU', null),
    ('Thorne Meriva 500-SF', 'Curcumin', 1000, 'mg', null),
    ('Thorne Zinc Picolinate', 'Zinc', 30, 'mg', 273.0),
    ('Thorne Vitamin D K2 Liquid', 'Vitamin D3', 50, 'mcg', 250.0),
    ('Thorne Vitamin D K2 Liquid', 'Vitamin K2', 100, 'mcg', 83.0),
    ('Thorne Magnesium Biglycinate', 'Magnesium', 180, 'mg', 43.0),
    ('Thorne NAC', 'Vitamin C', 60, 'mg', 67.0),
    ('Thorne NAC', 'Ashwagandha', 200, 'mg', null),
    ('Thorne NAC', 'CoQ10', 25, 'mg', 25.0),
    ('Thorne Curcumin Phytosome', 'Curcumin', 500, 'mg', null),
    ('Thorne Daily Greens Plus', 'Probiotic Blend', 3000000000, 'CFU', null),
    ('Sports Research Omega-3 Fish Oil', 'Omega-3 EPA', 690, 'mg', 276.0),
    ('Sports Research Omega-3 Fish Oil', 'Omega-3 DHA', 450, 'mg', 180.0),
    ('Sports Research Collagen Peptides', 'Collagen Peptides', 11000, 'mg', null),
    ('Sports Research Turmeric Curcumin', 'Curcumin', 1000, 'mg', null),
    ('Sports Research Vitamin D3', 'Vitamin D3', 62.5, 'mcg', 313.0),
    ('Sports Research Biotin', 'Biotin', 10000, 'mcg', null),
    ('Sports Research K2 D3', 'Vitamin D3', 50, 'mcg', 250.0),
    ('Sports Research K2 D3', 'Vitamin K2', 120, 'mcg', 100.0),
    ('Sports Research L-Theanine', 'L-Theanine', 200, 'mg', null),
    ('Sports Research Ashwagandha', 'Ashwagandha', 600, 'mg', null),
    ('Sports Research MCT Oil', 'MCT Oil', 14000, 'mg', null),
    ('Sports Research Multi-Collagen', 'Collagen Peptides', 12000, 'mg', null),
    ('Life Extension Two-Per-Day Capsules', 'Vitamin C', 250, 'mg', 278.0),
    ('Life Extension Two-Per-Day Capsules', 'Vitamin D3', 50, 'mcg', 250.0),
    ('Life Extension Two-Per-Day Capsules', 'Vitamin B12', 500, 'mcg', 20833.0),
    ('Life Extension Super Omega-3', 'Omega-3 EPA', 720, 'mg', 288.0),
    ('Life Extension Super Omega-3', 'Omega-3 DHA', 480, 'mg', 192.0),
    ('Life Extension Magnesium L-Threonate', 'Magnesium', 144, 'mg', 34.0),
    ('Life Extension Vitamin D3 5000 IU', 'Vitamin D3', 125, 'mcg', 625.0),
    ('Life Extension Super Ubiquinol CoQ10', 'CoQ10', 100, 'mg', 100.0),
    ('Life Extension Ultra Prostate Formula', 'Zinc', 15, 'mg', 136.0),
    ('Life Extension Ultra Prostate Formula', 'Curcumin', 300, 'mg', null),
    ('Life Extension Neuro-Mag', 'Magnesium', 144, 'mg', 34.0),
    ('Life Extension NAD+ Cell Regenerator', 'Vitamin B12', 100, 'mcg', 4167.0),
    ('Life Extension NAD+ Cell Regenerator', 'Folate', 400, 'mcg', 100.0),
    ('Life Extension Mix Tablets', 'Vitamin C', 400, 'mg', 444.0),
    ('Life Extension Mix Tablets', 'Vitamin D3', 50, 'mcg', 250.0),
    ('Life Extension Wellness Code Whey', 'Collagen Peptides', 5000, 'mg', null),
    ('Jamieson Vitamin C Chewable', 'Vitamin C', 500, 'mg', 556.0),
    ('Jamieson Vitamin D3 1000 IU', 'Vitamin D3', 25, 'mcg', 125.0),
    ('Jamieson Omega-3 Select', 'Omega-3 EPA', 400, 'mg', 160.0),
    ('Jamieson Omega-3 Select', 'Omega-3 DHA', 200, 'mg', 80.0),
    ('Jamieson Probiotic 10 Billion', 'Probiotic Blend', 10000000000, 'CFU', null),
    ('Jamieson Zinc 50 mg', 'Zinc', 50, 'mg', 455.0),
    ('Jamieson Melatonin 5 mg', 'Melatonin', 5, 'mg', 500.0),
    ('Jamieson Collagen Anti-Wrinkle', 'Collagen Peptides', 2500, 'mg', null),
    ('Jamieson Collagen Anti-Wrinkle', 'Vitamin C', 60, 'mg', 67.0),
    ('Jamieson Multivitamin for Women', 'Vitamin B12', 100, 'mcg', 4167.0),
    ('Jamieson Multivitamin for Women', 'Iron', 18, 'mg', 100.0),
    ('Jamieson Vitamin B12 Energy Spray', 'Vitamin B12', 500, 'mcg', 20833.0),
    ('Jamieson Calcium Magnesium with Vitamin D3', 'Calcium', 600, 'mg', 50.0),
    ('Jamieson Calcium Magnesium with Vitamin D3', 'Magnesium', 100, 'mg', 24.0),
    ('Jamieson Calcium Magnesium with Vitamin D3', 'Vitamin D3', 25, 'mcg', 125.0)
)
insert into public.supplement_ingredients (supplement_id, ingredient_id, amount, unit, daily_value_percentage)
select
  s.id,
  i.id,
  ld.amount,
  ld.unit,
  ld.daily_value_percentage
from link_data ld
join public.supplements s on s.name = ld.supplement_name
join public.ingredients i on i.name = ld.ingredient_name
on conflict (supplement_id, ingredient_id) do update
set
  amount = excluded.amount,
  unit = excluded.unit,
  daily_value_percentage = excluded.daily_value_percentage,
  updated_at = timezone('utc', now());
