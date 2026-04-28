# CI Check Loop Skill

Iteratively get a GitHub PR to a fully green check state, or exit with a concrete blocker.

Invoke after pushing a branch when PR checks are failing or pending. This skill drives a repair loop — it does not stop at a local fix. The loop only closes when the remote PR checks for the new head SHA are green.

## Scope

- GitHub PRs only. Stop immediately on GitLab repos.
- Focus on CI status checks for the **latest head SHA**, not stale commits.
- Does not handle review comments or PR template issues — those belong to `review-pr`.

## Inputs

- **PR number** (optional): detect from current branch if omitted.
- **Max iterations**: default 5.

## Loop

### Step 1 — Identify the PR

```bash
gh pr view --json number,headRefName,headRefOid,url,isDraft
```

Stop early if: `gh` is not authenticated, no PR exists for this branch, or the repo is not on GitHub.

### Step 2 — Track the latest head SHA

Always work against the current head SHA. After every push, refresh it:

```bash
PR_JSON=$(gh pr view "$PR_NUMBER" --json number,headRefName,headRefOid,url)
HEAD_SHA=$(echo "$PR_JSON" | jq -r .headRefOid)
```

Ignore failures from older SHAs.

### Step 3 — Inventory checks for the SHA

```bash
gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs?per_page=100"
gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/status"
```

Or via GraphQL for a compact view:

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      headRefOid
      statusCheckRollup {
        contexts(first:100) {
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl workflowName }
            ... on StatusContext { context state targetUrl description }
          }
        }
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr="$PR_NUMBER"
```

**Terminal success**: check runs `SUCCESS / NEUTRAL / SKIPPED`; status contexts `SUCCESS`.
**Pending**: `QUEUED / PENDING / WAITING / IN_PROGRESS`.
**Failure**: `FAILURE / TIMED_OUT / CANCELLED / ACTION_REQUIRED`.

### Step 4 — Wait for checks to appear

After a push, poll every 15–30 seconds until all checks are in a terminal state or at least one failed. Give up after 2 minutes if no checks appear for the new SHA.

### Step 5 — Investigate failures

```bash
gh run list --commit "$HEAD_SHA" --json databaseId,workflowName,status,conclusion,url
gh run view <RUN_ID> --json databaseId,name,status,conclusion,jobs,url
gh run view <RUN_ID> --log-failed
```

Classify each failure:

| Type | Action |
|------|--------|
| Code / test regression | Reproduce locally, fix, verify |
| Lint / type / build | Run the matching local command from the workflow, fix |
| Flake / transient | Rerun once if evidence supports flakiness |
| External service / outage | Escalate with details URL and owner |
| Missing secret / permission | Escalate immediately |

Only rerun a failed job once without code changes. Do not loop on reruns.

### Step 6 — Fix actionable failures

1. Read the failing workflow to identify the real gate.
2. Reproduce locally (run the exact command from the workflow).
3. Make the smallest correct fix.
4. Run focused verification, then broader if needed.
5. Commit in a logical commit.
6. Push before re-checking.

```bash
git push
```

Then refresh `HEAD_SHA` and restart from Step 3.

### Step 7 — Exit conditions

Exit the loop when:
- All checks for the latest head SHA are green, **or**
- A blocker remains after reasonable repair effort, **or**
- Max iteration count is reached.

### Step 8 — Escalate blockers

If checks cannot be made green, report exactly:
- PR URL and latest head SHA
- Failing check names and details URLs
- What was tried and why it is blocked
- Who should likely unblock it
- The next concrete action

## Output

When the skill completes:
- PR URL and branch
- Final head SHA
- Green / pending / failing check summary
- Fixes made and verification run
- Whether changes were pushed
- Blocker summary if not fully green
