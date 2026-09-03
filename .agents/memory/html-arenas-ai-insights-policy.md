---
name: AI Insights policy classification
description: Durable safety and quota rules for policy handling in the athlete AI Insights feature.
---

Policy intent is classified by an exclusive, reason-allowlisted `policy_refusal` model result, not by a pre-model keyword filter. The server owns the exact refusal prose. Valid policy refusals and all rejected/malformed model outputs refund the request's exact quota slot. If the model misses a prescriptive question but returns an ordinary valid finding, only server-rendered prose grounded in allowlisted evidence may reach the user, and the normal quota slot remains consumed.

Questions unsupported by the available context use an exclusive, reason-allowlisted `not_answerable` result with server-owned copy and an exact-slot refund. Core calendar, sport, rest-day, and average dimensions should be exposed as direct server-computed paths. General derived findings are deliberately deferred; if added later, the server must recompute allowlisted arithmetic from validated source paths rather than trust model math.

Evidence formatting is normalized without weakening evidence equality: bracket indices become canonical dot paths, and strict finite numeric strings are coerced before the existing 1e-9 comparison. Mismatch logs may include expected/received scalar values and types only after the path passes the safe schema allowlist; arbitrary received text remains null.

**Why:** Keyword filtering falsely refused legitimate historical questions containing words such as workout, rest, routine, weight training, injury, or medical. Output-side classification avoids those false positives while the typed evidence validator keeps a classifier miss from becoming model-authored advice.

**How to apply:** Keep policy refusal and not-answerable results exclusive, reject extra fields/prose or mixed findings, preserve answerable/not-answerable/policy test partitions, canonicalize evidence paths, and never loosen exact numeric equality beyond safe representation coercion.