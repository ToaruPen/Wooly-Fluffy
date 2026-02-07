---
description: Consult or review code using OpenAI Codex CLI
argument-hint: <request>
allowed-tools: Bash, Read, Grep, Glob
---

Process the following request using Codex CLI.

**Request:** $ARGUMENTS

## Procedure

1. Analyze the request and gather relevant code context via Read / Grep as needed
2. Build a self-contained prompt for Codex from the gathered information
3. Execute Codex via Bash (set timeout to 300000)

### Execution Commands

For general consultation / analysis:

```
codex exec --sandbox read-only -C <project_root> "<prompt>"
```

For code review, use the dedicated subcommand:

```
codex exec review --base main -C <project_root> "<additional_instructions>"
```

### Model and Reasoning Effort

Defaults are loaded from `~/.codex/config.toml`. Override per-invocation when needed:

- Model: `-m <model>` (e.g. `-m gpt-5.3-codex`, `-m gpt-5.3-codex`)
- Reasoning effort: `-c model_reasoning_effort="<level>"` (low / medium / high / xhigh)

Example with overrides:
```
codex exec --sandbox read-only -m gpt-5.3-codex -c model_reasoning_effort="xhigh" -C <project_root> "<prompt>"
```

Choose model/effort based on task complexity:
- Quick questions or simple review: default config is sufficient (omit flags)
- Moderate analysis: high (default)
- Complex architecture analysis or deep debugging: xhigh

### Prompt Construction Rules

- Prompts must be specific and self-contained (Codex has no prior context)
- Include full file paths when targeting specific files
- Always append the following to the end of the prompt:
  "No confirmation or questions needed. Proactively provide concrete suggestions, fixes, and code examples. Respond in Japanese."
- For long prompts, pipe via stdin:
  ```
  echo "<prompt>" | codex exec --sandbox read-only -C <project_root> -
  ```

4. Analyze and organize Codex output, then report in the following format:

### Codex Findings
(Summary and structured presentation of Codex output)

### Additional Observations
(Your own analysis, supplementary notes, or differing perspectives if any)

## Constraints

- ALWAYS use `--sandbox read-only` (never let Codex modify files)
- Never pass security-sensitive content (API keys, credentials) to Codex
- Present Codex output as "third-party advisory opinion" — do not apply directly
- Clearly distinguish between Codex findings and your own analysis
