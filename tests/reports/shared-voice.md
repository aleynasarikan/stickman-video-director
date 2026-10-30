# Shared voice consistency update

2026-10-12: user requested a voice-only shared foundation for all visual styles, preserving choice of different voices for different videos and consistent identity across clips within each video. No new prior-art search: this is a targeted correction of an existing output contract, not a new skill or substantial redesign. The abstract rule is to freeze a complete identity/delivery/recording profile per video, not to prescribe one voice universally.

## Accepted provider sample

Style 2A Hope story, 16:9, Omni 1.1 Flash, 720p, three independent 10-second clips. The baseline used a broad warm-young-American-male narrator description. The comparison replaced only that paragraph with the complete off-screen adult-male/clean-baritone block now in voice-continuity.md. Reverse-replacement equality checked that visuals, character wording, dialogue, music, SFX and negatives were otherwise byte-identical. Old clips were retained. No voice/audio reference or external dub used.

Comparison asset IDs: f4974401-60cd-4b6b-92ba-99b286adfd1b; 012e2519-a2cd-43c6-8f04-0d573e73ace8; 1f9b95cf-f2d6-4373-9745-384a74de653f. Stored prompts and completion were browser-verified. The user listened and reported that the three new clips sounded like one person, then requested this update. The agent did not independently receive audio for listening; this is user listening acceptance, not a quantitative speaker-similarity metric.

## Scope and evidence boundary

Shared instructions route Style 1 Light/Dark, Style 2A/2B and Style 3 through one voice contract. The tested male block is retained verbatim. Female/older/other profiles remain configurable; illustrative adaptations and all-style routing are design changes, not separate provider-proven matching results. Cross-style, different-topic, alternative-voice and longer-duration audio comparisons remain missing evidence. No universal guarantee is made. Voice-only updating does not resolve character drift, prop continuity, BGM matching or other visual defects.

Deterministic verification checks complete voice block equality, rejects drift/shortcuts, permits different voices across separate examples, confirms all shared routing, and preserves example visual beats/dialogue. Behavioral cases are documented but not independently executed by a model/provider. Existing Classic-character and README regression tests remain applicable. This is a scoped branch/PR repository update; no new versioned Release or clean-install result is asserted.

The auxiliary generic package validator/publisher does not support this existing repository layout: it expects a skill-local README.md, agents/interface.yaml and manifest.json, while this project keeps its README at repository root and agents/openai.yaml. Its formal package/release gates did not pass. Preserve the existing format rather than introducing unrelated format or identity changes; publish only through a feature branch and gated PR.
