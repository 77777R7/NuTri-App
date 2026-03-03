# Scan Results UX Review (Reliability + Clarity)

Date: 2026-02-28  
Scope: Scan result surfaces shown in screenshots (Product Overview, Science & Ingredients, Practical Usage, Safety & Tips, Data status).  
Goal: Make results feel reliable and informative for an average customer, while still supporting power users via progressive disclosure (details on demand).

---

## Executive Summary (What’s Not Working)

1. **Too much internal/technical language in the default view**  
   Examples observed: `match score 0.40`, `RBF 0.92`, `within_typical`, `Band thresholds`, `KB: reviewed_package`, `Confidence 0.40 / B`.
   - This reads like an internal evaluation tool, not a consumer product.
   - It can reduce trust because users cannot interpret what “0.40/B” means.

2. **Redundancy and echoing across modules**  
   The same ideas repeat in multiple places: “data status limited”, “label warnings missing”, UL summary duplicated, “evidence is mixed” repeated.
   - Repetition feels like filler and increases cognitive load.

3. **Source boundaries are *present* but not *actionable***  
   You do label sections with “NIH ODS (not product-specific)” and “Verified dataset”, but:
   - it’s still hard to answer “What is proven vs general vs inferred?”
   - the UI doesn’t consistently show *why* a claim appears (short provenance).

4. **Data-quality messaging feels like a bug report**  
   “Data status: limited” appears multiple times with long explanations.
   - Average users want “what’s missing + what to do next”, not repeated diagnostics.

---

## Product-Level Principles (What We Should Optimize For)

### A) Trust ladder (every claim has a source tier)
Default view should clearly separate:
- **Verified** (official dataset / label facts)
- **General science** (NIH ODS, not product-specific)
- **AI summary** (clearly labeled, grounded to listed sources)

### B) Progressive disclosure (simple first, details optional)
Default view: plain language + minimal numbers.  
Details view: the technical metrics for debugging/power users.

Reference: CDC plain-language checklist emphasizes putting the most important message first and deleting unnecessary words.  
Reference: “Progressive disclosure” is a standard UX pattern for hiding advanced info until needed.

### C) One “missing info” explanation, one “next step”
A single “Missing info” panel should:
- list missing fields (short)
- explain impact (one line)
- give a next action (Scan label / View official record)

---

## Proposed Changes (Clear Add / Change / Remove)

### 1) **Remove** (from default customer view)

Remove or hide behind “Details”:
- Numeric internal scores and jargon: `match score`, `RBF`, `0.40/B`, `within_typical`, `band thresholds`, `KB:*`.
- Repeated meta disclaimers (“Evidence is mixed…” repeated in multiple cards).
- Duplicate UL bullets that restate the same fact in different words.
- Nutrition / trivia content inside Safety (e.g., “best food sources”) unless it’s explicitly labeled as a “Tip” and kept short.

Why: These don’t help a customer decide “Is this trustworthy?”; they mostly explain the system to itself.

### 2) **Change** (wording + information architecture)

#### Product Overview sheet
Change headings/copy:
- “What this product is” → **“Verified product summary”**
- “What we verified (Facts-first checks)” → **“Verified from the official record”**
- “Context notes / Data quality status: limited” → **“Missing info (from the record)”**

Change the top of the sheet to answer 3 questions fast:
1) What is it? (name, brand, form)  
2) What’s the dose? (per serving + direction)  
3) Where did this come from? (source + date + link)

#### Science & Ingredients
Make the default Science card shorter:
- Replace long “General science background” block with:
  - 2–3 bullets (plain language)
  - “Learn more” link/button

Form & bioavailability:
- If form is not explicitly on the verified record, show **“Form: not stated on label record”** (not a guessed form).
- If you *do* have a form signal but it’s low confidence, show it as **“Possible form (low confidence)”** without numeric match scores.

#### Practical Usage
Remove repeated “Per-serving dose …” if it already appears in Overview/Ingredients.
- Prefer a single “Directions (from label/record)” row and a single “Timing tip (general)” row.

#### Safety & Tips
Restructure Safety into three clear buckets:
1) **Label warnings (if present)**  
2) **Upper limit (UL) guidance (general)**  
3) **Interactions / watch-outs (general)**  

Prevent duplicates:
- UL info should appear once as a structured mini-table (UL, product amount, what it means).

### 3) **Add** (what average customers need to trust the result)

#### A) “Why you can trust this” micro-panel (always visible)
Add a small panel near the top:
- “Verified from: LNHPD (Health Canada) / DSLD (NIH)”  
- “Last updated: YYYY-MM-DD” (or “Retrieved on”)  
- “Web evidence: used / not used”
- “Tap to view sources”

#### B) Sources drawer (simple, not technical)
Add a bottom drawer listing:
- Official record link (LNHPD/DSLD page or internal canonical record)
- NIH ODS fact sheet link (if used)
- Any other sources (web pages) with quality badge

#### C) Confidence summary in plain language
Replace numeric confidence with:
- **High / Medium / Limited**
- A 1-line reason: “Limited because: label warnings missing; form not stated.”

#### D) Single CTA to improve accuracy
When missing key fields (warnings, ingredient amounts, form):
- Show a single CTA: **“Scan Supplement Facts + Warnings panel”**
- Avoid repeating the same “missing” block in multiple modules.

---

## Concrete Rewrite Examples (Copy That Reads Like a Product)

### Product Overview (Missing info)
Current style: “Data quality status: limited.”  
Proposed:
- **Some label details aren’t included in this official record.**  
  Missing: label warnings, chemical form.  
  To improve accuracy: scan the Supplement Facts + Warnings panel.

### Science (General vs verified)
Proposed label pattern:
- **Verified (from label/official record)**: “Vitamin D: 1000 IU (25 mcg) per tablet.”  
- **General science (NIH ODS)**: “Vitamin D supports bone health and calcium balance.”  
- **AI summary (grounded)**: “Summary based on: verified label facts + NIH ODS.”

### Safety (UL)
Proposed structured block:
- **Upper limit (adults 19+): 100 mcg/day (NIH ODS)**  
  This product: **25 mcg per serving**  
  Note: UL considers total intake from all sources.

---

## Implementation Backlog (What To Change in Code)

This is written as a minimal, high-ROI set of changes (not a redesign).

1) **Introduce “Simple vs Details” toggle (global)**
- Default: Simple
- Details: reveals match scores / RBF / thresholds / KB tags

2) **Deduplicate “data status limited”**
- Convert to a single shared component used by all modules.

3) **Add source + freshness panel**
- Render from bundle meta: `sourceType`, `sourceTypeFinal`, `fetchedAt`, `datasetVersion` (where available).

4) **Safety cleanup**
- Ensure UL/watch-outs aren’t repeated across “Label warnings”, “General watch-outs”, and “Safety summary AI”.

---

## Success Criteria (How We Know It’s Better)

Qualitative (user-facing):
- A first-time user can answer in <10 seconds:
  - What is this supplement?
  - What’s the dose/directions?
  - Is this info verified or general?
  - What should I do if something is missing?

Quantitative (instrumentation):
- Reduced “open/scroll depth” required to find dose + key warnings.
- Increased “source drawer opened” rate (trust check) with low bounce.
- Lower “confusion feedback” tags (e.g., “too technical”, “unclear source”, “repeating”).

---

## References (For Product Rationale)

- CDC: Plain language checklist (write for comprehension, remove unnecessary text):  
  https://www.cdc.gov/health-literacy/php/develop-materials/plain-language.html
- NIH ODS: Disclaimer / trustworthy general supplement info (good model for “general, not personal advice”):  
  https://ods.od.nih.gov/About/Disclaimer.aspx
- FDA: Standard “not evaluated by FDA” disclaimer language on supplement structure/function claims (useful for how we phrase claims/limits):  
  https://www.fda.gov/food/information-industry-dietary-supplements/notifications-structurefunction-and-related-claims-dietary-supplement-labeling

