# Personalization Phase 0 Foundation

## Scope

- Added a conservative Phase 0 personalization data pack for goals, ingredient match hints, blocker strategies, diet review lanes, activity direction, safety caps, explanation templates, and feature flags.
- Normalized the catalog shapes so `goal_catalog.v1.json`, `goal_ingredient_map.v1.json`, and `safety_rules.v1.json` match the personalization runtime consumers that already read them.
- Added JSON schemas for every Phase 0 config plus a focused test that validates each file against its schema and checks shared-contract alignment.

## Guardrails

- Goal, type, and blocker keys match the existing shared contract in `types/personalization.ts` and the onboarding enums in `lib/onboarding-v2.ts`.
- Diet and activity data stay review-oriented and directional only. They define starter taxonomy keys and timing anchors, not diagnosis or dosing behavior.
- Sensitive V1 ingredient mappings stay conservative by routing libido-related rows, iron, and green tea extract through the generic safety path instead of granting unrestricted ranking confidence.
- Feature flags remain fully off so the data foundation can land before any personalization UI or ranking behavior is exposed.

## Phase 1/2 Assumptions

- Phase 1 should add typed loaders/adapters for these catalogs rather than changing the JSON keys again.
- Diet and activity onboarding are still freeform today, so Phase 1 or 2 should provide alias normalization from labels such as `Low dairy`, `Gluten free`, `Running`, and `Yoga` into the starter keys defined here.
- Later phases can expand ingredient coverage and explanation copy, but should preserve the current cap semantics for `low_disclosure`, `proprietary_blend`, `diet_constraint_conflict`, and `generic_safety_path`.
