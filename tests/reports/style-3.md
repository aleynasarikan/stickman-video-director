# Style 3 update — 2026-10-12

Scope: add Prehistoric Hand-Drawn / Dark Comedy to the existing directing-stickman-videos package. No fight mode implementation. Owner remains kaomei. Preserve other visual modes.

Reference mechanisms inspected: skill-creator (scoped, progressive-disclosure authoring) and qiaomu-meta-skill (generalization/evidence boundaries and feature-branch publication). This is a focused extension to an existing skill, not a new package or substantial redesign; external prior-art discovery was not required. Keep the existing Codex folder structure rather than migrate it to Qiaomu manifest/interface conventions.

Design advantages: fixed drawing grammar with story-specific casting; complete per-role anchors within a story; physical prop transfer and scene layout checks; fiction/fact separation; comedy reaction pauses instead of forced effects or discussion questions. The original contribution is separating cross-story visual identity from within-story character identity.

Evidence: three ten-second Flow clips generated for one workplace satire, approved visually by the user, then subtitled and assembled by the user. The provided file is 30.000 seconds, 1920×1080 H.264 with AAC. The repository copy is compressed; the source file is unchanged. An eight-second animated preview accompanies the complete video.

Validation: README contract checks pass for six files; git whitespace check passes. Added behavioral cases in tests/scenarios/prehistoric-casting.md were reviewed against the new instructions but have NOT been independently executed by a model or video provider. Cross-topic, age/gender and reference-based continuity remain missing evidence. No guaranteed completion rate, character or voice matching is claimed for the new style.

Tool limits: skill-creator quick_validate could not run because PyYAML is absent. Qiaomu validator/publisher requires its own README, interface and manifest inside the skill folder, so its dry-run does not support this existing package without an unrelated migration. Use the existing repository checks and native feature-branch/PR flow; do not claim a Qiaomu release gate passed. Versioned Release/discovery/clean-install checks are outside this focused update and are not reported as complete.

Boundaries: generating footage, paid retries, account access and public uploads are not implied by skill invocation. Subtitles remain post-production. A failed visual identity check should stop costly retries and be reported. Rollback is by reverting the update commit/PR; no history rewrite or destructive deletion.
