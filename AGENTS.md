# Golden State Visions portal agent rules

## Required context

- Read `/Users/cory/Projects/app-gsvisions/README.md` completely before inspecting, editing, testing, migrating, committing, or deploying this portal.
- Treat that README as the canonical architecture, operations, safety, and handoff document.
- If code and README disagree, verify actual behavior, fix the appropriate source, and update the README in the same scoped change.
- Every completed portal task must leave the README accurate enough for a new chat to continue without relying on hidden conversation history.

## Production and repository safety

- Canonical portal source is `/Users/cory/Projects/app-gsvisions` on `main`.
- Production is `https://app.gsvisions.co` through the Vercel `app-gsvisions` project.
- Inspect the dirty working tree before editing and preserve unrelated user work.
- Do not send customer email, initiate/capture/refund payments, mutate production data, change DNS, deploy, commit, push, or discard unrelated changes without user authorization.
- Never use a real email, payment, refund, or customer order as a smoke test.
- Never claim a push is live until the production alias points to a Ready deployment.

## Connected website

- The public booking website is `/Users/cory/Documents/Real Estate Media` on `master`.
- Read its own `AGENTS.md` before acting there.
- Portal/website contracts must stay synchronized, especially catalog, pricing, customer identity, appointment/twilight semantics, payments, confirmation email, and duplicate-booking protection.

## Handoff requirement

- End work with the handoff fields defined in the portal README.
- Explicitly identify all local changes not live, their purpose, whether they are still needed, and any production side effects.
- Keep both repositories clean whenever all intended work is complete; never achieve cleanliness by deleting or discarding unreviewed user work.
