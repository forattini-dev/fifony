You are resolving git merge conflicts in a software project.

## Context

Issue: {{issueIdentifier}} — {{title}}
{{#if description}}
Description: {{description}}
{{/if}}
Merging branch `{{featureBranch}}` into `{{baseBranch}}`.

## Conflicting Files

The following files have conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) that you must resolve:

{{#each conflictFiles}}
- {{this}}
{{/each}}

## Instructions

1. Read each conflicting file and understand the intent of BOTH sides.
2. Resolve ALL conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) by choosing the correct combination of changes. Prefer keeping both sides' intent when possible.
3. CRITICAL: Before staging, run `grep -n "^<<<<<<<" <file>` on EACH file to verify zero conflict markers remain. If any markers remain, fix them first.
4. After verifying each file is clean, stage with `git add <file>`.
5. Do NOT commit — the merge commit will be created automatically after you finish.
6. Do NOT modify files that are not in the conflict list.
7. Do NOT use `git add .` or `git add -A` — stage only the conflicting files listed above.
