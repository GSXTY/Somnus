---
name: project-handoff
description: Use when starting, resuming, pausing, switching tools, or handing off project work where prior chat context may be missing.
---

# Project Handoff

## Overview

Keep project handoff context cheap: one short rolling project file, not a chat transcript.

## Entry Workflow

1. Read project instructions first: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or equivalent.
2. If `docs/AI-HANDOFF.md` exists, read it before planning or implementation.
3. Treat the handoff as current operational context; treat code, tests, and durable docs as the source of truth if they disagree.

## When to Update

Update only at key nodes:

- before stopping, pausing, switching tools, or explicitly handing off
- after finishing a coherent task chunk
- after a decision changes implementation direction
- after a failing verification or blocker future agents must know
- after discovering context that prevents duplicate work

Do not update for routine exploration, tiny replies, or facts already obvious in project instructions, README files, tests, code, or an issue tracker.

## Rolling File Rules

- Default path: `docs/AI-HANDOFF.md`.
- Keep it under about 80 lines.
- Replace stale details; do not append a long diary.
- Prefer facts and exact verification results over narrative.
- Record uncertainty as uncertainty.
- Keep secrets, credentials, private tokens, and large logs out.
- Mention file paths and verification commands only when helpful.

## Template

```markdown
# AI Handoff

## Current Focus
...

## Last Meaningful Changes
...

## Open Decisions / Risks
...

## Verification Status
...

## Next Step
...
```

## Quality Bar

A new tool should understand what is active, what changed, what is risky, what was verified, and the next move in under one minute.
