# Week 3 Real Saved Stack Readiness

Generated: 2026-03-14T23:15:45.227Z
Audit source label: local_saved_products

## Remote saved coverage
- Queried user_supplements rows: 0
- Remote pools discovered: 0
- Remote candidate rows: 0
- Remote skipped rows: 0

## Local saved coverage
- Local libraries discovered: 2
- Total local saved items: 4
- Local candidate rows: 1
- Local skipped rows: 1

### local-expo:CB15D2:6C5AA7
- Storage type: expo_async_storage
- Storage path: /Users/howard07/Library/Developer/CoreSimulator/Devices/CB15D242-7E36-4B00-A676-AD20387F3AE9/data/Containers/Data/Application/6C5AA765-3A4A-4E3A-AED0-89A5EB035A19/Documents/ExponentExperienceData/@anonymous/nutri-app-0efe1201-d162-40ca-8411-a838196b65cb/RCTAsyncLocalStorage
- Total saved items: 3
- Barcode-backed items: 1
- Supplement-linked items: 1
- Snapshot-backed items: 1
- Usable candidate items: 0
- Skipped snapshot items: 1
- Excluded reasons: label_only_saved_item=2, snapshot_without_usable_actives=1
- Product: Probiotic (15B CFU) (label_only_saved_item, label:65e34817-265276)
- Product: Vitamin D3 (label_only_saved_item, label:202872d4-172308)
- Product: Vitamin B1 (Thiamine mononitrate). (snapshot_without_usable_actives, 00000017381521)

### local-native:CB15D2:F6B1B7
- Storage type: native_app
- Storage path: /Users/howard07/Library/Developer/CoreSimulator/Devices/CB15D242-7E36-4B00-A676-AD20387F3AE9/data/Containers/Data/Application/F6B1B7D0-0BA0-4BB4-81A1-D7C458B83D51/Library/Application Support/com.nutri-Nige.app/RCTAsyncLocalStorage_V1
- Total saved items: 1
- Barcode-backed items: 1
- Supplement-linked items: 1
- Snapshot-backed items: 1
- Usable candidate items: 1
- Skipped snapshot items: 0
- Excluded reasons: none
- Product: Vitamin D 1000IU (Tablet) (usable_candidate, 00064642079992)

## Case readiness
- Case 1 ready: no
- Case 2 ready: no
- Case 3 ready: no
- Environment had enough real saved products: no
- Final decision if audit ran now: Week 3 not yet fully closed

## Blockers
- local + remote audit sources still cannot form all 3 required real-stack cases
