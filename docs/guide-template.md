---
title: Replace with a task-oriented title
description: Replace with a short summary of the outcome.
requires:
  tables: []
  columns: []
  config: []
---

# Replace with a task-oriented title

Describe the outcome, intended audience and any important safety limitations.

## Prerequisites

List the software, access and working state needed before starting.

## Procedure

Describe each step in order. Give commands as fenced code blocks and explain placeholders.

## Verification

Show how to verify success and what output to expect.

## Troubleshooting

Describe likely failures and safe recovery steps.

## Contributor checklist

- Copy this file to `docs/docs/guides/` with a descriptive `.md` filename and remove this checklist.
- Write plain CommonMark, with no JSX, so the guide remains readable on GitHub. Use GitHub-style
  alerts rather than Docusaurus-only directive syntax.
- Declare every schema table, qualified column and configuration key the procedure depends on in
  `requires`. Keep an empty list when a category has no dependencies; do not invent dependencies.
- Do not hand-write a version range. Review the derived schema range and dependency locks with the
  guide. Confirm every declaration is a known entity.
- Check commands, links, accessibility and recovery instructions against the target environment.
