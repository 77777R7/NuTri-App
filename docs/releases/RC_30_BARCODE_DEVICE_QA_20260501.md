# RC 30-Barcode Device QA - 2026-05-01

Purpose: final manual device checklist for the release candidate.

Release branch: `release/rc-1`
Required app code ancestor: `e77ee517 Fix release scan result simulator blockers`
Render target: `https://nutri-app-qn0u.onrender.com`

## How To Run

Use a real iPhone build, preferably TestFlight. Expo Go simulator does not validate the physical camera path.

For each barcode:

- [ ] Scan succeeds.
- [ ] Result page opens without crash.
- [ ] Product identity is visible.
- [ ] NuTri Score or limited-data state is visible.
- [ ] Core cards are visible.
- [ ] Product Overview renders or safely falls back.
- [ ] Ingredient / Formula Overview renders or safely falls back.
- [ ] Scientific Background / Research Snapshot renders or safely falls back.
- [ ] Suggested Use / Warnings render or clearly explain missing label data.
- [ ] No visible blank, unavailable, undefined, null, or `[object Object]`.

If a product fails, record exact barcode, screenshot, app build, time, network, and whether retry succeeded.

## Current Status

The same 30 barcodes passed Render route QA with no 5xx, no client timeout, and no AI P0/P1. One real-device/TestFlight barcode scan was user-confirmed passed on 2026-05-01. The manual 30-device pack below remains available if the release owner wants the strictest final pass before broader beta.

## Device / Build

- Device:
- iOS version:
- App build number:
- Tester:
- Date:
- Network:

## Barcode Pack

| # | Barcode | Family | Product | Scan | Result opens | Identity | Score | Core cards | Deep Dive | No bad visible text | Notes |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `00624777000904` | omega_3 | Genuine Health omega3 daily | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 2 | `00064642103413` | magnesium | Jamieson 100% Pure Magnesium L-Threonate | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 3 | `00854378001462` | iron | CanPrev Iron Bis-Glycinate 20 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 4 | `00625273035865` | vitamin_c | Webber Naturals Vitamin C 1000 mg Timed Release Tablets | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 5 | `00064642097552` | vitamin_d | Jamieson Vitamin D3 2,500 IU Softgels | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 6 | `00733739812513` | calcium | NOW Calcium Magnesium with Vitamin D and Zinc | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 7 | `00064642049629` | zinc | Jamieson Zinc Lozenges | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 8 | `00064642028235` | b12 | Jamieson Vitamin B12 1,200 mcg Timed Release | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 9 | `00625273036770` | probiotic_or_blend | Webber Naturals The Right Fibre4 Probiotic Low FODMAP | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 10 | `00624777010408` | collagen | Genuine Health clean collagen bovine | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 11 | `00624777007002` | creatine | Genuine Health fermented BCAA+ creatine | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 12 | `00624777013690` | protein | Genuine Health fermented organic vegan proteins+ | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 13 | `00624777009303` | fiber | Genuine Health high fibre gut superfoods+ | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 14 | `00624777011405` | electrolyte_hydration | Genuine Health enhanced electrolytes+ | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 15 | `00854378001165` | milk_thistle | CanPrev Meno-Prev + Mood & Memory | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 16 | `00810078475514` | red_yeast_rice | Vitamatic Red Yeast Rice + CoQ10 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 17 | `00706195004624` | schisandra_chinensis | Oregon's Wild Harvest Organic Schisandra | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 18 | `00886646503453` | ashwagandha | CanPrev Ashwagandha Body & Mind | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 19 | `00624777012518` | turmeric | Genuine Health fast joint care with NEM and turmeric | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 20 | `00886646502883` | curcumin | CanPrev Curcumin Unlocked | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 21 | `00624917044829` | berberine | AOR Berberine | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 22 | `00810078475071` | nac | Vitamatic NAC + Milk Thistle | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 23 | `00624917043433` | green_tea_extract | AOR Active Green Tea | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 24 | `00854378001349` | coq10 | CanPrev Antioxidant Network | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 25 | `00064642061379` | glucosamine | Jamieson Glucosamine 500 mg | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 26 | `00625273036022` | melatonin | Webber Naturals Melatonin 5 mg Time Release | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 27 | `00886646502791` | folate | CanPrev B9 Folate Drops | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 28 | `00625273038132` | b6 | Webber Naturals Vitamin B6+B12 with Folic Acid | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 29 | `00838287001560` | same | Metabolic Maintenance SAMe + Cofactors | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |
| 30 | `00713947552708` | tocotrienols | Nutricology Delta-Fraction Tocotrienols | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] | |

## Failure Triage

Classify any failure into one bucket:

- `app_crash`
- `camera_permission`
- `scan_no_detection`
- `route_5xx`
- `client_timeout`
- `blank_result`
- `missing_score`
- `missing_core_cards`
- `visible_unavailable`
- `bad_visible_text`
- `login_or_subscription_blocker`
- `other`

## Sign-Off

- Total scanned:
- Passed:
- Failed:
- Retried and passed:
- Open blockers:
- Decision: `GO` / `GO_WITH_WATCH` / `NO_GO`
