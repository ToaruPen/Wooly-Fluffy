# /review

Legacy compatibility command.

This repository uses `/final-review` as the canonical DoD review command.

## Usage

```text
/review <PR_NUMBER_OR_ISSUE_NUMBER>
```

## Behavior

- Treat this command as an alias to `/final-review`.
- Follow `.agent/commands/final-review.md` for the complete and up-to-date procedure.
- `--ac-only`: only AC verification

## Related

- `.agent/rules/dod.md` - Definition of Done
- `.agent/rules/docs-sync.md` - documentation sync rules
- `.agent/commands/sync-docs.md` - sync-docs command

## Next steps

- Approved: if no PR exists, run `/create-pr`; otherwise can merge
- Approved with nits: if no PR exists, run `/create-pr`; otherwise can merge (optionally batch-fix P2/P3)
- Blocked: fix P0/P1 -> run `/review-cycle` -> re-run `/review`
- Question: answer questions (do not guess) -> run `/review-cycle` -> re-run `/review`
