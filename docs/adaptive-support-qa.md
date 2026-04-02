# Adaptive Support QA

This checklist is for validating the current deterministic adaptive-support flow in development builds.

## Surfaces to watch

- `Profile > Personalization`
- Goal Navigator
- Goal Fit detail and Compare
- Schedule defaults / reminder controls
- Supabase `user_personalization_events`
- `GET /api/personalization/debug/goal-navigator-bundle`

## How to verify each run

For every scenario below, capture:

- the final `supportState` shown in the dev-only debug card on [ProfileScreen.tsx](/Users/howard07/NuTriApp/nutri-app/components/screens/ProfileScreen.tsx)
- whether the expected event row landed in `user_personalization_events`
- whether the Profile debug card updates after returning from the action

## Scenario Matrix

| ID | Goal | Setup | Action | Expected support state | Expected evidence |
| --- | --- | --- | --- | --- | --- |
| `AS-01` | Fresh explore baseline | Signed-in user, no saved products, no recent personalization events | Open app and go straight to Profile | `explore` | Debug card shows low event count and no install signals |
| `AS-02` | Choose via blocker | User has `goal_fit_uncertainty` from onboarding | Open Profile | `choose` | `support_state_choose` reason includes blocker |
| `AS-03` | Choose via decision research | Clear recent events for the user | Open Goal Navigator, open Compare, then open a Goal Fit detail | `choose` | Event rows: `goal_navigator_opened`, `compare_opened`, `goal_fit_detail_opened` |
| `AS-04` | Install via schedule progress | User has no saved stack and no prior install signals | Edit schedule defaults once | `install` | Event row: `schedule_edited`; debug card install signals increments |
| `AS-05` | Save/unsave stays cautious | User has exactly 1 saved product | Save a product, then unsave it shortly after | `choose` | Event row: `save_then_unsave`; debug card should not stay in premature install |
| `AS-06` | Reminder pushback stays cautious | User has 1 saved product and has not accepted first stack or customized schedule | Disable reminders twice | `choose` | Two `reminder_disabled` rows; debug card should not move into install just because one product is saved |
| `AS-07` | Setup progress beats reminder pushback | User has real install progress | Edit schedule defaults, then disable reminders twice | `install` | `schedule_edited` present; reminder pushback does not fully cancel install state |
| `AS-08` | Stabilize by usage | User has 3+ saved products or strong streak | Open Profile | `stabilize` | Debug card support state changes without needing new personalization events |
| `AS-09` | Optimize by consistency | User has high consistency and 5+ saved products | Open Profile | `optimize` | `support_state_optimize` reason with high consistency |

## Manual Steps

1. Sign in with a test account.
2. Start from [ProfileScreen.tsx](/Users/howard07/NuTriApp/nutri-app/components/screens/ProfileScreen.tsx) and note the current debug card state.
3. Execute the scenario actions above.
4. Return to Profile and confirm the state transition.
5. Validate the event rows in Supabase or through app behavior.

## Current known-good backend checks

- Goal Navigator bundle debug route should return:
  - active run id
  - runtime source
  - precomputed hit rate
  - top candidate-gap priorities
- A healthy local runtime currently shows `source: storage` after a Goal Navigator request.

## Suggested SQL spot checks

```sql
select event_name, surface, created_at
from user_personalization_events
where user_id = '<test-user-id>'
order by created_at desc
limit 20;
```

```sql
select support_state, updated_at, last_snapshot_id
from user_personalization_state
where user_id = '<test-user-id>';
```

## Pass criteria

- Every expected event row is recorded once the action is taken.
- `supportState` changes match the table above.
- The Profile debug card reflects the new state without a crash or empty shell.
- Goal Navigator debug route continues to return bundle metrics successfully.
