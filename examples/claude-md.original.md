# CLAUDE.md — Project Guidelines

This file provides important guidelines for Claude when working on this codebase.

## Core Principles

When you are making changes to this project, please always follow these principles:

- **Understand before you change**: Always read the existing code carefully before making any modifications to it
- **Be conservative with changes**: Only change what is actually needed to complete the task at hand
- **Verify your work**: After making changes, please run the tests and verify that everything still works as expected

## Style Guidelines

Please follow these style guidelines for all code you write in this project:

1. Use TypeScript for all new files unless there is a specific reason to use JavaScript
2. Always use named exports rather than default exports
3. Prefer functional programming patterns over object-oriented ones wherever possible
4. Never use `any` type — always provide a proper type annotation

## Testing

For testing, we use Jest as our primary test runner. When you are writing tests, please make sure to:

- Write tests that are deterministic and do not depend on external state
- Mock external API calls using the existing mock utilities
- Add integration tests for any new API endpoints you create
- Run the entire test suite before committing any changes

## Git Workflow

When working with git in this repository, please follow these rules:

- Never force push to the main branch under any circumstances
- Always create a feature branch for your work before making changes
- Use conventional commit messages (feat:, fix:, docs:, etc.)
- Squash commits before merging pull requests if requested
