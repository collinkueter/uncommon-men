# Profile and inline activity history — September 22, 2026

- `npm run check` passed: TypeScript, 35 tests, production build.
- Profile name/icon links to the existing audited identity editor, with safe return to the originating activity. Existing-name matching and unchanged identity links are covered by tests.
- Mobile profile target measured 44×44 at a 320px viewport; document width remained 320px. Desktop name and icon are both clickable.
- Keyboard clearing leaves the name empty and disables Save. Save returns to the original event; Cancel preserves the name. Browser automation's empty-string `fill` did not clear this controlled input reliably, so this case was verified with Select All and Backspace.
- Idle own-name drafts update to a newly selected profile. Running/nonzero timers preserve their competitor. Browser verified a running Marcus Reed timer continued while the recorder profile changed back to Caleb Johnson; it was then stopped and reset.
- Inline history filtered Caleb's Bar Hang attempts (two fixture records), Marcus's (one record), and a partial name (no unrelated records). URL remained `/events/bar-hang`.
- With history expanded, a sample 3-second manual result appeared immediately as the third record without refresh/navigation. The 2:18.40 fixture remained marked as the best attempt.
- Shared attempt rendering serves both the inline panel and the My Results page.
- Test writes used browser-local demo data. No production participant/results records or Firebase rules were changed.

Visual evidence: [mobile history](screenshots/profile-history/mobile-history.png).
