---
name: Club Pro gate environment parity
description: Environment difference and required verification approach for Club Pro entitlement behavior.
---

Railway production sets `CLUB_PLAN_GATES_ENABLED` truthy, while the ordinary Replit development workflow leaves it unset and therefore bypasses Club Pro gates.

**Why:** Tests against the default Replit server can prove feature calculations and role behavior while giving false confidence about subscription enforcement. Production runs the opposite gate mode.

**How to apply:** Use the dedicated Club Pro gate verifier, which spawns an isolated server with the flag enabled, whenever changing club subscriptions, gated APIs, locked dashboard states, or admin/coach entitlement behavior. Do not flip the Replit default merely to test this boundary.