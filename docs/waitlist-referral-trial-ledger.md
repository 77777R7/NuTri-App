# Waitlist Referral Trial Ledger

Supabase is the only source of truth for NuTri waitlist signup, referral, and trial bonus state. beehiiv is used only for email delivery.

## Source of Truth

- `waitlist_signups`: one row per signup email, with its short `referral_code`, UTM JSON, beehiiv subscription metadata, and signup status.
- `waitlist_referrals`: one confirmed referral credit per referred email. Self-referrals are blocked and duplicate referral credit is prevented by unique constraints.
- `waitlist_trial_bonuses`: one trial preview/activation row per email.
- `waitlist_referral_milestone_events`: idempotent outbox rows for beehiiv milestone emails. Pending events can be claimed later so an early missing beehiiv automation config does not permanently lose the notification.

## Referral Flow

1. A joins on the website.
2. `/api/waitlist` computes A's short referral code and writes `waitlist_signups` plus `waitlist_trial_bonuses`.
3. A sees `https://trynutri.app/?ref=xxxx`.
4. B opens A's link and joins.
5. `/api/waitlist` rejects self-referral, writes B, inserts one confirmed `waitlist_referrals` row, recalculates A's `referred_count`, and updates A's trial bonus row.
6. If A crosses 1, 2, or 3 confirmed friends, Supabase creates a milestone outbox event. The website API then asks beehiiv to send the milestone email.
7. The website API also claims a small batch of pending milestone events after each configured signup request, so queued notifications can be recovered once the beehiiv automation is connected.

## Trial Rules

- Default: 3 days.
- 1 confirmed friend: 4 days total.
- 2 confirmed friends: 5 days total.
- 3 or more confirmed friends: 7 days total.
- The cap is permanent at 7 days.

## App Paywall Contract

- Login reads `get_waitlist_trial_bonus_preview`.
- Preview reads do not start the trial.
- The paywall button displays `Start your X-day free trial`.
- Only the paywall button calls `activate_waitlist_trial_bonus`.
- After activation, `usePremiumAccess` sees the active, unexpired row and treats it as premium.
- Users never enter a code manually.
