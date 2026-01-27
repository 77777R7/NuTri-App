# Findings & Decisions
<!-- 
  WHAT: Your knowledge base for the task. Stores everything you discover and decide.
  WHY: Context windows are limited. This file is your "external memory" - persistent and unlimited.
  WHEN: Update after ANY discovery, especially after 2 view/browser/search operations (2-Action Rule).
-->

## Requirements
<!-- 
  WHAT: What the user asked for, broken down into specific requirements.
  WHY: Keeps requirements visible so you don't forget what you're building.
  WHEN: Fill this in during Phase 1 (Requirements & Discovery).
  EXAMPLE:
    - Command-line interface
    - Add tasks
    - List all tasks
    - Delete tasks
    - Python implementation
-->
<!-- Captured from user request -->
- Move the yellow "Plan" card down; the "Tap card to edit." area is too close to the section above.
- Adjust the Plan card top-right logo (clock) upward to sit centered in the header area.

## Research Findings
<!-- 
  WHAT: Key discoveries from web searches, documentation reading, or exploration.
  WHY: Multimodal content (images, browser results) doesn't persist. Write it down immediately.
  WHEN: After EVERY 2 view/browser/search operations, update this section (2-Action Rule).
  EXAMPLE:
    - Python's argparse module supports subcommands for clean CLI design
    - JSON module handles file persistence easily
    - Standard pattern: python script.py <command> [args]
-->
<!-- Key discoveries during exploration -->
- Active UI area is the yellow Plan card within the progress section on Home screen.
- No direct matches for "Tap card to edit" or "Plan" text in `app/main/Home-Page.tsx`; may be rendered via constants or other components.
- `app/main/Home-Page.tsx` renders `<ProgressScreen />`, so Plan card likely defined in `components/screens/ProgressScreen`.
- Plan card layout/styles should be inside `components/screens/ProgressScreen.tsx`.
- Plan card section uses `<View style={[styles.sectionSpacing, { marginTop: tokens.sectionGap }]} />` and includes `styles.squareIconWrap` for the top-right clock.
- "Tap card to edit." text uses `styles.squareFooter` inside the Plan card body.
- `sectionSpacing` has `marginTop: 0`; the Plan section applies `marginTop: tokens.sectionGap` inline.
- `squareHeaderRow` uses `alignItems: 'flex-start'`, and `squareIconWrap` is a 36x36 circle with centered content.
- Applied `marginTop: tokens.sectionGap + 12` to the Plan section and added `planIconWrap` with `translateY: -4`.

## Technical Decisions
<!-- 
  WHAT: Architecture and implementation choices you've made, with reasoning.
  WHY: You'll forget why you chose a technology or approach. This table preserves that knowledge.
  WHEN: Update whenever you make a significant technical choice.
  EXAMPLE:
    | Use JSON for storage | Simple, human-readable, built-in Python support |
    | argparse with subcommands | Clean CLI: python todo.py add "task" |
-->
<!-- Decisions made with rationale -->
| Decision | Rationale |
|----------|-----------|
| Add extra top margin to Plan section | Create more breathing room below the progress card |
| Apply a small upward translate on Plan card icon | Center the clock icon visually in the header |

## Issues Encountered
<!-- 
  WHAT: Problems you ran into and how you solved them.
  WHY: Similar to errors in task_plan.md, but focused on broader issues (not just code errors).
  WHEN: Document when you encounter blockers or unexpected challenges.
  EXAMPLE:
    | Empty file causes JSONDecodeError | Added explicit empty file check before json.load() |
-->
<!-- Errors and how they were resolved -->
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
<!-- 
  WHAT: URLs, file paths, API references, documentation links you've found useful.
  WHY: Easy reference for later. Don't lose important links in context.
  WHEN: Add as you discover useful resources.
  EXAMPLE:
    - Python argparse docs: https://docs.python.org/3/library/argparse.html
    - Project structure: src/main.py, src/utils.py
-->
<!-- URLs, file paths, API references -->
- app/main/Home-Page.tsx

## Visual/Browser Findings
<!-- 
  WHAT: Information you learned from viewing images, PDFs, or browser results.
  WHY: CRITICAL - Visual/multimodal content doesn't persist in context. Must be captured as text.
  WHEN: IMMEDIATELY after viewing images or browser results. Don't wait!
  EXAMPLE:
    - Screenshot shows login form has email and password fields
    - Browser shows API returns JSON with "status" and "data" keys
-->
<!-- CRITICAL: Update after every 2 view/browser operations -->
<!-- Multimodal content must be captured as text immediately -->
- Screenshot shows the yellow Plan card immediately under the blue progress card; the top spacing is tight.
- The Plan card header includes a circular clock logo on the right that sits slightly low; user wants it higher/centered.

---
<!-- 
  REMINDER: The 2-Action Rule
  After every 2 view/browser/search operations, you MUST update this file.
  This prevents visual information from being lost when context resets.
-->
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
