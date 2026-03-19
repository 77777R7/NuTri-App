# Fish Oil Framing Migration Plan

## Goal

Use `fish_oil_omega3` as the mature template for category-specific consumer framing, then migrate the same design pattern to:

- `metabolic_glucose_support`
- `cholesterol_lipid_support`
- `liver_bile_support`

This is not a taxonomy-detection project. Taxonomy is already working. This is a consumer-explanation specialization project.

## Why `fish_oil_omega3` is the template

`fish_oil_omega3` already behaves like a mature lane because it has all four framing layers:

1. `Overview` says what the product family is for in category-native language.
2. `Science` says what comparison logic matters for this category.
3. `Usage` makes category-relevant timing or administration visible.
4. `Safety` highlights category-relevant caution context instead of only generic warnings.

In code, the strongest signals live in:

- `/Users/howard07/NuTriApp/nutri-app/backend/src/decisionSupport.ts`
  - `fish_oil_omega3` overview bullets around lines `591-597`
  - fish-oil checklist and blocker logic around `1010-1109`, `1714`, `1833-1854`
  - fish-oil science framing and next-step text around `2360-2601`
  - fish-oil safety/watchout routing around `2799-2897`

## Reverse-engineered mature framing pattern

### 1. Overview pattern

`fish_oil_omega3` overview has three jobs:

- Define the real user goal:
  - "increasing omega-3 intake as part of a heart/vascular-support routine"
- Define the key comparison lens:
  - `EPA + DHA per serving`
- Define the main comparison trap:
  - fish-oil mg alone is weaker than EPA+DHA disclosure

General template:

1. `Best for: <category-native user goal>`
2. `Good if you want: <category-native comparison metric>`
3. `Not ideal if: <category-specific transparency trap>`

### 2. Science pattern

`fish_oil_omega3` science does three jobs:

- Anchor the category to a familiar goal frame
- State the per-serving ingredient fact in the category's native comparison language
- End with a category-native next step

General template:

1. `Often used for <category-native goal frame> (general science).`
2. `This product provides <key active fact>, and <category comparison state>.`
3. `Main limitation: <category-specific blocker or no blocker>. Next step: <category-native compare action>.`

### 3. Usage pattern

`fish_oil_omega3` usage does not rewrite directions from scratch. It makes category-relevant timing visible.

General template:

- Preserve label directions
- Surface category-relevant timing cue if present
- Do not invent stronger protocol guidance than the label supports

### 4. Safety pattern

`fish_oil_omega3` safety works because it does not stop at generic pregnancy/medication warnings. It adds category-relevant watchouts:

- blood thinners
- surgery
- fish-oil-specific caution context

General template:

- Keep label warnings
- Add a category-specific watchout layer
- Keep that layer bounded and conservative

## Migration design by new category

### A. `metabolic_glucose_support`

#### Overview framing

Target framing:

1. `Best for: products used for glucose / glycemic-support routines.`
2. `Good if you want: clear berberine or glucose-support actives per serving so products are easier to compare.`
3. `Not ideal if: meal-timing or active disclosure is unclear, because those details matter when comparing glucose-support products.`

#### Science framing

Target comparison logic:

- Primary active lens:
  - `berberine`
- Secondary lens:
  - named glucose-support actives and per-serving dose clarity
- Main blocker:
  - category still looks too generic when it only says "ingredient support"

Target science sentence shape:

1. `Often used for glucose- or glycemic-support goals.`
2. `This product provides <berberine / active> per serving, and <meal-timing / active disclosure> is <clear or unclear>.`
3. `Next step: compare active dose and whether the label gives useful meal-timing guidance.`

#### Usage framing

Category-specific cues to elevate:

- before meals
- with meals
- blood sugar / glucose wording

#### Safety framing

Category-specific watchouts to elevate:

- diabetes medication context
- glucose-lowering context
- pregnancy / breastfeeding only when label or general caution supports it

### B. `cholesterol_lipid_support`

#### Overview framing

Target framing:

1. `Best for: products used in cholesterol / lipid-support routines.`
2. `Good if you want: clear red-yeast-rice or lipid-support actives per serving so products are easier to compare.`
3. `Not ideal if: the label relies on broad herb language without clarifying the lipid-support actives or supporting context.`

#### Science framing

Target comparison logic:

- Primary active lens:
  - `red yeast rice`
- Secondary lens:
  - lipid-support supporting actives like `CoQ10` when present
- Main blocker:
  - generic herb comparison instead of lipid-support framing

Target science sentence shape:

1. `Often used in cholesterol / lipid-support routines.`
2. `This product provides <red yeast rice / lipid-support active> per serving, and <supporting actives / label clarity> determine how easy it is to compare.`
3. `Next step: compare the core lipid-support active and whether the label adds enough context for long-term comparison.`

#### Usage framing

Category-specific cues to elevate:

- with food
- with meals
- consistent daily use language, if present on label

#### Safety framing

Category-specific watchouts to elevate:

- pregnancy
- liver caution context
- medication context where clearly supported

### C. `liver_bile_support`

#### Overview framing

Target framing:

1. `Best for: products used for bile-flow, fat-digestion, or liver-bile support routines.`
2. `Good if you want: clear TUDCA / ox-bile / bile-support actives per serving.`
3. `Not ideal if: the product blends digestive language without clarifying the liver-bile actives or fat-meal context.`

#### Science framing

Target comparison logic:

- Primary active lens:
  - `TUDCA`
  - `ox bile`
- Secondary lens:
  - bile-support positioning versus broad digestive enzyme positioning
- Main blocker:
  - currently many rows still explain these like generic digestive support

Target science sentence shape:

1. `Often used for bile-flow or liver-bile support goals.`
2. `This product provides <TUDCA / ox bile / bile-support active> per serving, and <fat-meal or digestive context> affects how well the label supports comparison.`
3. `Next step: compare the core bile-support active and whether the label clearly explains when to use it with meals.`

#### Usage framing

Category-specific cues to elevate:

- with meals containing fat
- with food
- mealtime wording

#### Safety framing

Category-specific watchouts to elevate:

- gallbladder / bile context when supported
- liver condition context when supported
- practitioner consultation wording, if present

## Implementation order

### Pass 1: Overview + Science only

Implement category-native framing for:

- `metabolic_glucose_support`
- `cholesterol_lipid_support`
- `liver_bile_support`

Do not widen taxonomy detection in this pass.

Success criteria:

- `overviewSpecificityRate >= 70%`
- `scienceSpecificityRate >= 70%`
- `overviewGenericRate <= 20%`
- `scienceGenericRate <= 20%`

### Pass 2: Usage + Safety specialization

Once overview/science are category-native, add:

- category-specific usage cue extraction
- category-specific safety watchout phrasing

Success criteria:

- `usageSpecificityRate` materially improves over current baseline
- `safetySpecificityRate` materially improves over current baseline
- generic safety fallback remains only a minority path

### Pass 3: Re-run experience validation

Use:

- `/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/build-iherb-category-experience-validation-pack.mjs`

Decision rule:

- If the three new live categories stop reading as generic, keep long-tail cleanup as a background lane.
- If they still read generic, continue experience specialization before any full-corpus cleanup project.

## What not to do

- Do not widen category regexes in this project.
- Do not treat long-tail unknown cleanup as the mainline while new live categories still speak in generic copy.
- Do not replace label directions with invented protocol advice.
- Do not add aggressive safety claims beyond label-supported or conservative general-watchout context.
