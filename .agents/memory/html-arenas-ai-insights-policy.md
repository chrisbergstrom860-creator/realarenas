---
name: AI Insights policy classification
description: Durable safety and quota rules for policy handling in the athlete AI Insights feature.
---

Policy intent is classified by an exclusive, reason-allowlisted `policy_refusal` model result, not by a pre-model keyword filter. The server owns the exact refusal prose. Valid policy refusals and all rejected/malformed model outputs refund the request's exact quota slot. If the model misses a prescriptive question but returns an ordinary valid finding, only server-rendered prose grounded in allowlisted evidence may reach the user, and the normal quota slot remains consumed.

**Why:** Keyword filtering falsely refused legitimate historical questions containing words such as workout, rest, routine, weight training, injury, or medical. Output-side classification avoids those false positives while the typed evidence validator keeps a classifier miss from becoming model-authored advice.

**How to apply:** Keep policy refusal exclusive, reject extra fields/prose or mixed findings, preserve the permanent descriptive/refusal intent matrix, and never weaken exact-slot refund or server-owned rendering behavior.