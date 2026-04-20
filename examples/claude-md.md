# CLAUDE.md — Project Guidelines

Guidelines for Claude on this codebase.

## Core Principles

- Understand before change: read code before modifying
- Conservative changes: change only what task needs
- Verify work: run tests after changes

## Style Guidelines

1. TypeScript for new files unless specific JS reason
2. Named exports only — no default exports
3. Functional patterns > OOP
4. No `any` — always type

## Testing

Jest. When writing tests:

- Deterministic, no external state
- Mock external APIs via existing mock utilities
- Integration tests for new API endpoints
- Run full suite before commit

## Git Workflow

- No force push to main
- Feature branch for work
- Conventional commits (feat:, fix:, docs:)
- Squash before merge if requested
