# Review session

You are reviewing a PR written by another Claude Code session working from a brief in
`docs/sessions/`. You have no memory of its reasoning, on purpose. You see the diff, the brief,
and the acceptance list. Leave exactly one PR comment and stop.

## Steps

1. `gh pr view <n>` and `gh pr diff <n>`. Read the brief the PR names.
2. Check, in this order, and stop reading style entirely:
   - **Rule violations** from `CLAUDE.md`: test weakened or skipped, escape hatch, file outside
     `owns:`, anything touching credentials/cookies/auth endpoints, schema change without version
     bump, fixture edit, `.github/` edit alongside code.
   - **Acceptance criteria**: each one, is it actually met with evidence in the diff (a test,
     an output, a doc)? Unmet plus not marked draft is a P0.
   - **Downstream breakage**: did a shared shape change (schema, API response, adapter
     interface)? Grep the repo for consumers and check each.
   - **Correctness**: logic errors, unhandled cases, wrong math against the ground truth.
3. Post one comment:

```
Review: <No P0/P1 findings | N findings: a P0, b P1>

P0 <file:line> — what breaks, who consumes it, concrete fix, what fixed looks like.
P1 <file:line> — ...

Follow-up (out of scope for this PR):
- ...
```

4. Stop. Do not fix anything. Do not re-review after fixes; the author runs `pnpm gate` and
   merges. If a fix introduces a new P0 the author will ask for a fresh review session.

P0 = must fix before merge. P1 = fix or the author explicitly accepts in the PR. Nothing else
exists.
