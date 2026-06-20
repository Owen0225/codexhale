```markdown
# codex-codewhale-cc Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill introduces the core development patterns and workflows used in the `codex-codewhale-cc` TypeScript codebase. You'll learn the project's coding conventions, how to add new features with tests, update plugin manifests, and maintain installation documentation. This guide also explains the repository's commit and testing styles, ensuring your contributions align with established practices.

## Coding Conventions

- **Language:** TypeScript
- **Framework:** None detected
- **Commit Messages:** Follows [Conventional Commits](https://www.conventionalcommits.org/) with prefixes like `feat`, `fix`, `docs`, `chore`.

### File Naming

- Use **camelCase** for file names.
  - Example: `myLibraryModule.ts`

### Import Style

- Mixed usage of import styles.
  - Named imports:
    ```typescript
    import { myFunction } from './utils';
    ```
  - Default imports (less common):
    ```typescript
    import myModule from './myModule';
    ```

### Export Style

- Prefer **named exports**.
  - Example:
    ```typescript
    export function doSomething() { ... }
    export const CONSTANT = 42;
    ```

## Workflows

### Add New Library Module with Tests

**Trigger:** When adding new core functionality to the plugin, ensuring it is tested  
**Command:** `/new-lib-module`

1. **Implement the Feature:**
   - Create or update a file in `plugins/codexhale/scripts/lib/*.mjs`.
   - Example:
     ```typescript
     // plugins/codexhale/scripts/lib/myFeature.mjs
     export function myFeature() {
       // implementation
     }
     ```
2. **Write Corresponding Tests:**
   - Create or update a test file in `tests/*.test.mjs`.
   - Example:
     ```typescript
     // tests/myFeature.test.mjs
     import { myFeature } from '../plugins/codexhale/scripts/lib/myFeature.mjs';

     test('myFeature works', () => {
       expect(myFeature()).toBe(/* expected result */);
     });
     ```

### Update or Fix Plugin Manifest

**Trigger:** When making the plugin installable or fixing schema errors in the manifest  
**Command:** `/update-manifest`

1. Create or update `plugins/codexhale/.claude-plugin/plugin.json` with the correct schema fields.
   - Example:
     ```json
     {
       "name": "codex-codewhale-cc",
       "version": "1.0.0",
       "description": "A plugin for Codewhale",
       ...
     }
     ```

### Update Installation Documentation

**Trigger:** When documenting or clarifying installation steps, or fixing documentation errors  
**Command:** `/update-install-docs`

1. Create or update `docs/INSTALL.md` with new instructions or corrections.
   - Example:
     ```markdown
     # Installation

     1. Clone the repository.
     2. Run `npm install`.
     3. Follow configuration steps as described below.
     ```

## Testing Patterns

- **Test Files:** Use the pattern `*.test.ts` (or `*.test.mjs` for modules).
- **Framework:** Unknown (use standard Node.js or your preferred test runner).
- **Example Test:**
  ```typescript
  // tests/example.test.ts
  import { exampleFunction } from '../src/example';

  test('exampleFunction returns true', () => {
    expect(exampleFunction()).toBe(true);
  });
  ```

## Commands

| Command             | Purpose                                                        |
|---------------------|----------------------------------------------------------------|
| /new-lib-module     | Add a new library module with corresponding tests              |
| /update-manifest    | Update or fix the plugin manifest for installability or schema |
| /update-install-docs| Update installation instructions or documentation              |
```