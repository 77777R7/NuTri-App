# NuTri Onboarding Visual System v2

## 1. Purpose

This document defines the updated visual system for NuTri onboarding after:

- direct product-direction decisions
- external onboarding research
- welcome/allergy step redesign work
- review against OpenAI's frontend design guidance

This version is more concrete than v1. It is intended to guide:

- visual design
- motion design
- copy structure
- UI implementation
- design QA

It should be treated as the onboarding design source of truth until replaced by
another revision.

## 2. Research Basis

This direction is grounded in:

- [OpenAI: Designing delightful frontends with GPT-5.4](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4)
- [Apple HIG: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
- [Apple: Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)
- [Apple WWDC18: Intentional Design](https://developer.apple.com/videos/play/wwdc2018/802/)
- [Apple WWDC21: Build a research and care app, part 1: Setup onboarding](https://developer.apple.com/videos/play/wwdc2021/10068/)
- [Appcues: Mobile onboarding best practices](https://www.appcues.com/blog/mobile-onboarding-best-practices)
- [UXCam: Better mobile onboarding](https://uxcam.com/blog/better-mobile-onboarding/)
- [HeroUI v3: Introduction](https://v3.heroui.com/docs/react/getting-started)
- [HeroUI: Card](https://heroui.com/docs/react/components/card)
- [HeroUI: Styling](https://v3.heroui.com/docs/react/getting-started/styling)

## 3. Final Product Intent

NuTri onboarding should feel:

- premium
- clean
- guided
- trustworthy
- science-aware

It should not feel like:

- a survey
- a hospital intake form
- a generic startup carousel
- a dashboard made from stacked cards

The target user feeling is:

- `NuTri understands me`
- `This feels premium and trustworthy`
- `This will help me make better supplement decisions`

The experience should feel like a professional matching journey, not a form.

## 4. Overall Visual Thesis

### Visual thesis

`A premium supplement-matching journey with clean white and deep navy surfaces, a real product-context anchor, and restrained liquid-glass interaction layers.`

### Content plan

1. Brand-led entry
2. Value and trust orientation
3. Fast matching questions
4. Payoff and handoff

### Interaction thesis

1. The welcome flow should open with a smooth poster-like transition, not an abrupt screen swap.
2. QA steps should feel guided and continuous, with tactile choice feedback.
3. Glass should create touch, lift, and flow, not decoration.

## 5. Hard Principles

### 5.1 One job per screen

Every screen should do one primary thing:

- welcome
- explain trust
- ask one question
- preview payoff
- hand off to the next action

### 5.2 The first viewport should feel like a composition

The first onboarding screen must feel like a designed composition, not a layout
stack.

It must have:

- one dominant visual idea
- one clear CTA
- one strong headline
- one controlled hierarchy

### 5.3 Real context over premium abstraction

Abstract materials can support the page, but they cannot carry the whole idea.

The first two screens should be grounded in recognizable NuTri context:

- supplement product context
- fit/matching context
- UI prediction or recommendation context

### 5.4 Motion should guide

Motion should:

- create flow
- make transitions feel inevitable
- reinforce selection
- build atmosphere

It should not:

- become ornamental
- distract from reading
- turn onboarding into a carousel gimmick

### 5.5 Restraint over UI clutter

Avoid:

- dashboard-card mosaics
- badge soup
- feature stacks
- multiple accent colors
- detached floating widgets with no structural role

## 6. Color and Material System

### 6.1 Palette

Onboarding should stay aligned with the main product direction.

Recommended palette:

- background: same family as the main page background
- primary dark: deep navy
- accent: NuTri blue
- surface: clean white / cool white
- secondary text: cool gray-blue
- soft support haze: very restrained blue fog only where needed

Rules:

- no color-heavy storytelling
- no wellness rainbow palette
- no mint/green primary shift
- one accent color by default

### 6.2 Material system

The base system should be:

- clean white planes
- deep-navy text hierarchy
- selective liquid-glass interaction surfaces

This should feel:

- premium
- calm
- tactile
- precise

It should not feel:

- glossy for the sake of it
- neon
- sci-fi
- medical

## 7. Glass / Liquid-Glass Rules

Glass should be used as an interaction material, not a page skin.

### 7.1 Strongest glass moments

#### Welcome

Most visible on:

- CTA container or CTA button
- one tightly integrated support plane inside the hero composition

#### QA pages

Most visible on:

- option surfaces
- selected state
- pressed and focus state

#### Allergy

Use a quieter version:

- lower blur intensity
- more stable surface tone
- less dramatic glow

### 7.2 Do not use glass for

- the whole background
- long copy panels
- every section on every page
- detached badges, labels, or promo callouts in the first viewport
- random floating chips over the hero

### 7.3 Behavior rules

- selected state should feel brighter and more anchored
- unselected state should feel calm and present
- text contrast must stay strong
- blur must stay soft and readable
- glass must never replace hierarchy

## 8. Carousel Decision

### Final decision

Use **2 intro slides**, then move into questions.

Do not use 3 or more intro slides.

### Why

This keeps the emotional entry and brand setup, but avoids dragging the user
into a long onboarding carousel before matching starts.

### Slide roles

#### Slide 1

Purpose:

- brand poster
- emotional hook
- promise of better fit

#### Slide 2

Purpose:

- trust and matching orientation
- clarify that NuTri helps narrow to what fits
- prepare the user for the question flow

### Transition rule

The transition from slide 1 to slide 2 should be one of the most polished
moments in the entire onboarding flow.

Recommended feel:

- shared movement
- soft liquid-glass continuity
- no hard page wipe
- no abrupt carousel snap

## 9. Welcome Screen Specification

## 9.1 Welcome role

The welcome screen is a brand poster plus product promise.

It is not:

- a feature list
- a mini dashboard
- a process explainer

## 9.2 Welcome real visual anchor

Final direction:

`One enlarged capsule as the hero object, with only a subtle dot-grid or ASCII-like texture treatment if it preserves object clarity and premium calm, mixed with a restrained NuTri UI support layer.`

This means:

- one capsule or softgel-like form is the dominant hero anchor
- the capsule should feel premium and intentional, not photoreal and not cartoon
- any ASCII-like or dot-grid treatment should remain subtle, secondary, and texture-led
- the object must still read immediately as a clear product-context anchor
- one or two integrated UI planes may support the composition
- those UI planes must feel attached to the hero idea, not like random overlays

This is the right compromise between:

- real product context
- premium abstraction
- non-generic tech aesthetic

## 9.3 Welcome composition

Structure:

1. very light progress hint
2. NuTri wordmark
3. hero statement
4. one support sentence
5. dominant capsule-led hero composition
6. single CTA

Hierarchy:

1. brand
2. headline
3. hero anchor
4. support copy
5. CTA

Hard rule:

- on slide 1, the `NuTri` wordmark must read as a hero-level signal, not a small app label
- if the wordmark is minimized to utility size, the screen has lost too much brand presence

## 9.4 Welcome copy direction

Headline should combine brand and result language.

Recommended direction:

- `Better supplement decisions start with what fits.`
- `Find what fits your body and your goals.`
- `NuTri helps you find what actually fits.`

Support line:

- one sentence only
- should promise value, not describe mechanics

Primary CTA:

- `Show me what fits`

## 9.5 Welcome preview content

Include **a very small amount** of preview content.

Rules:

- no explainer card
- no feature checklist
- no stacked mini widgets
- only one subtle supporting hint if needed

The page should still work if that hint disappears.

## 9.6 Welcome anti-goals

Do not build:

- a generic startup onboarding slide
- a travel-app-style floating card montage
- a glassy gradient hero with no product meaning
- a hero full of detached tags, chips, or badges

## 10. Slide 2 Specification

## 10.1 Role

Slide 2 should bridge brand and questions.

Its job is to say:

- NuTri will help narrow the fit
- this will be quick
- useful results are close

## 10.2 Visual direction

Use a calmer, more structured composition than slide 1.

Possible anchor:

- simplified fit/matching lane
- subtle path or flow from product context to recommendation context

This page can carry a little more explanation, but still only one main idea.

Hard rule:

- slide 2 must still scan in under 3 seconds
- if it starts reading like an explainer page or mechanism page, it has expanded too far

## 10.3 What not to do

- do not preview the full results UI
- do not show stacked cards that feel like a feed
- do not make this page more visually exciting than slide 1

## 11. QA Step System

### Final direction

QA steps should be **largely unified**, with room for small page-specific
variation.

This means:

- same vertical rhythm
- same title zone
- same option-zone logic
- same CTA placement
- same progress treatment

Allowed variation:

- welcome and slide 2 are special
- allergy gets a more cautious material tone
- plan-preview and first-stack can become more explanatory

## 12. Allergy Screen Specification

## 12.1 Allergy role

The allergy step is a guardrail checkpoint.

It should feel:

- careful
- supportive
- non-clinical

It should not feel:

- like medical paperwork
- like a warning dashboard
- like a settings dump

## 12.2 Allergy layout

Final structure:

1. light progress hint
2. title
3. one short support sentence
4. one tiny reassurance line
5. primary option board
6. more options reveal
7. restrictions cluster
8. no-known-allergies fast path
9. skip
10. continue CTA

## 12.3 Allergy option arrangement

Primary options:

- two-column layout
- equal visual family
- large pressable choice surfaces

Secondary options:

- one-column reveal list
- calmer and less dominant than primary options

Restrictions:

- separate but visually related cluster
- not equal in weight to the primary board

## 12.4 Allergy visual tone

This page should be a safety guardrail page, not a warning page.

Use:

- clean background
- low-noise glass choices
- soft outline or glow on selected choices
- calm spacing

Avoid:

- harsh yellow/orange warning language
- clinical form styling
- bulky boxed sections

## 12.5 Allergy content grouping

Primary supplement-relevant group:

- Fish
- Shellfish
- Dairy
- Soy
- Gluten
- Gelatin / animal-based

Expanded group:

- Egg
- Sesame
- Tree nuts
- Peanuts
- Wheat

Fast path:

- `No known allergies`

Exit path:

- `Skip for now`

## 13. Plan Preview Rule

Real product-card-style previews should appear in **plan-preview**, not in
welcome.

Reason:

- welcome should still be composition-first
- plan-preview is the correct payoff-oriented place to introduce result-lane UI

## 14. HeroUI Reference Rule

HeroUI should be used as a reference for:

- polished defaults
- accessible states
- semantic surface hierarchy
- customizable wrapper components
- restrained blur and motion

It should not be copied blindly.

Use the system direction from HeroUI, not HeroUI's visual identity.

Relevant takeaways:

- beautiful-by-default components can reduce low-value styling work
- wrapper components and theme overrides are the right way to keep a custom
  NuTri visual system
- semantic surface variants are more useful than one-off custom cards
- blur should be applied to specific surfaces that have a meaningful background
  behind them
- use HeroUI for state quality, accessibility, and surface behavior, not for default brand expression

## 15. Pre-build Reference Package

Before designing or implementing the onboarding redesign, prepare:

1. one or two visual references for the welcome hero mood
2. one do / don't example for glass usage
3. one real supplement context image or capsule reference
4. one sample of real NuTri product/result language
5. one safe-area mobile mock view

Do not design from adjectives alone.

## 16. Verification Requirements

Every redesigned onboarding screen must be checked in:

- mobile portrait first
- notch/safe-area states
- light background readability
- transition recording
- static screenshot review

Must verify:

- the first viewport still feels like one composition
- brand stays unmistakable
- CTA remains clear
- overlays do not cover key text
- glass never reduces readability
- the screen does not read like a survey

## 17. What to Avoid

Avoid:

- generic multi-slide startup onboarding
- too many stacked cards
- heavy feature explanation on the welcome flow
- abstract premium visuals with no NuTri context
- medical-form allergy styling
- detached hero labels, chips, or badges
- too many colors
- too many type sizes
- ornamental motion with no hierarchy value

## 18. Immediate Design Priorities

1. Redesign slide 1 welcome composition around the capsule-led real-context hero
2. Redesign slide 2 as a calmer trust/matching bridge
3. Redesign allergy as a guardrail checkpoint with two-column primary options
4. Keep QA screens mostly unified after the intro slides
5. Reserve true product/result preview cards for plan-preview
