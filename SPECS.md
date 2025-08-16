# Qyx Change — Functional Specification (OSS)

---

## 1 — Mission & constraints

**Mission:** Automatically generate high-quality, human-friendly release notes and changelogs from a repository’s commits/PRs/issues using the Claude Code SDK. No hosted service — everything runs in the user’s environment (GitHub Actions, local CLI, or self-hosted runner). Fully OSS (MIT by default). No monetization.

**Constraints & assumptions**

* Users will provide their own Anthropic credentials (API key or OAuth token). The tool will never ship or require Qyx-hosted credentials. The recommended environment variables are `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` (both supported by Claude Code setup flows). ([Anthropic][1])
* Implementation language: **TypeScript (Node 18+)** for the Action + CLI. Python SDK support can be added later.
* Primary LLM integration via `@anthropic-ai/claude-code` (query function / CLI) as provided by Anthropic's SDK. ([Anthropic][1])
* No centralized data store; optionally use GitHub Actions cache / artifacts for caching.

**Development Principles**

* **Modularity**: Every component must be designed as independent, pluggable modules to allow users to configure different actions (e.g., Twitter API posting, Slack notifications, custom webhooks)
* **Domain-Driven Design**: Clear separation of concerns with well-defined domain boundaries (Collection, Normalization, Generation, Output)
* **Excessive Documentation**: Every module, function, and configuration option must be thoroughly documented with examples

---

## 2 — High-level architecture

```
+-----------------+        (1) trigger        +-----------------------+
| GitHub Release  | ------------------------> | qyx-change GitHub     |
| / Tag / CLI run |                           | Action (Docker / JS)  |
+-----------------+                           +-----------------------+
                                                       |
                                                       | (2) collect commits, PRs, issues via GitHub API / git
                                                       |
                                                  +----v----+
                                                  | Normalizer |
                                                  +----+----+
                                                       |
                                                       | (3) build structured summary JSON
                                                       |
                                                  +----v----+
                                                  | Redactor |
                                                  +----+----+
                                                       |
                                                       | (4) prompt generation & Claude call
                                                       |
                                                  +----v----+
                                                  | Claude Code SDK |
                                                  | (query async iterator) |
                                                  +----+----+
                                                       |
                                                       | (5) structured markdown/json output
                                                       |
                                       +---------------+-----------------+
                                       | commit CHANGELOG.md / open PR   |
                                       | update GitHub Release body      |
                                       | create artifact / post to Slack |
                                       +---------------------------------+
```

No central server is required — Action runs inside GitHub runner with secrets. Local CLI performs same steps against local git and requires token env vars.

---

## 3 — Components & responsibilities

### 3.1 CLI (`qyx-change`)

* `qyx-change generate [--since <tag|sha>] [--to <tag|sha>] [--preview] [--config path]`

  * Uses local git to gather commits.
  * Looks up PRs via `gh` or GitHub API if token provided.
  * Produces `changelog.md` to stdout or file.
  * `--preview` opens interactive editor to tweak notes before committing.
* `qyx-change release --tag v1.2.3 --push`

  * Creates the tag, calls `qyx-change generate`, commits `CHANGELOG.md`, and optionally pushes & creates GitHub Release.
* Accepts env vars: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN` (for API calls).

### 3.2 GitHub Action (`action.yml`)

* Inputs:

  * `since` (optional), `to` (optional), `config` (path), `commit_changes` (true/false), `create_pr` (true/false), `changelog_path`
* Secrets:

  * `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`
  * `GITHUB_TOKEN` (automatically present in Actions)
* Runs the same logic as CLI but uses GitHub API first to query PRs for richer metadata.
* Produces artifacts: `delta.json`, `release-preview.md`.

### 3.3 Normalizer

* Parse commits and PRs into a canonical structure:

  ```ts
  type Change = {
    id: string;           // sha or PR id
    type: 'feat'|'fix'|'chore'|'perf'|'docs'|'security'|'other';
    scope?: string;       // optional
    title: string;
    body?: string;
    labels?: string[];
    author?: string;
    filesChangedCount?: number;
    linkedIssues?: string[];
  }
  ```
* Heuristics:

  * Prefer PR metadata (title, body, labels); fallback to commit messages.
  * Support conventional commits and mapping: `feat`→`Features`, `fix`→`Fixes`, `perf`→`Performance`, `docs`→`Docs`, `chore`→`Chores`, `BREAKING CHANGE` → developer notes/breaking.
  * Collapse duplicate entries (same PR referenced by multiple commits).
  * Limit long lists: if > N items in a section, summarize and link to `delta.json`.

### 3.4 Redactor / Privacy filter (critical)

* By default, **do not** send full diffs to Claude.
* Redaction policy (configurable):

  * Remove lines matching regexes for secrets: `(?i)apikey|secret|password|token|ssh-rsa|-----BEGIN PRIVATE KEY-----`
  * Replace emails with `[redacted-email]` and long hex strings with `[redacted-hash]`.
  * Optionally send only titles + PR numbers + short body truncated to N chars (default 300 chars).
* User can opt-in (explicit config) to include full diff snippets, but Action will require the secret `ALLOW_SEND_DIFFS=true` (explicit).

### 3.5 Prompting & Claude Code usage

* Use structured prompting: system prompt + user prompt + JSON output schema.
* Use streaming async iterator to capture progressive output and present preview in Action logs/artifacts.
* Use `output-format json` or `--print` flags for CLI calls when helpful. The Claude Code CLI/SDK supports `--output-format json` which aids automation. ([Anthropic][2])
* Provide cached prompts and local cache keyed by commit SHAs to avoid duplicate calls (GitHub Actions cache).

### 3.6 Output handlers

* Markdown `CHANGELOG.md` writer: idempotent (if section exists for tag, update).
* GitHub Release updater (via REST or GraphQL).
* Optionally open a PR (with `changelog` changes) using `GITHUB_TOKEN`.
* Optional push to Notion or Confluence via user-provided webhook / token.

---

## 4 — Config file (`.qyx-change.yml`) — schema + example

```yaml
# .qyx-change.yml
generator: claude-code
auth:
  mode: auto           # auto = prefer CLAUDE_CODE_OAUTH_TOKEN then ANTHROPIC_API_KEY
  token_env_var: CLAUDE_CODE_OAUTH_TOKEN

format:
  changelog_path: CHANGELOG.md
  sections:
    - name: "🚀 Features"
      labels: ["feature","feat"]
    - name: "🛠 Fixes"
      labels: ["bug","fix"]
    - name: "⚡ Performance"
      labels: ["perf"]
    - name: "📦 Chores"
      labels: ["chore"]
    - name: "🔒 Security"
      labels: ["security"]
  max_items_per_section: 20
  include_pr_links: true

generation:
  tone_preset: "concise"       # concise|friendly|formal|detailed|custom
  tone_file: "tones/custom.md" # path to custom tone file when tone_preset is 'custom'
  locale: "en-US"
  include_developer_notes: true
  developer_notes_template: |
    - BREAKING: {desc}
    - Migration: {instructions}
  send_diff_snippets: false

redaction:
  redact_patterns:
    - "(?i)api_?key"
    - "(?i)secret"
    - "-----BEGIN PRIVATE KEY-----"
  email_mask: true
  trunc_body_to: 300

cache:
  enabled: true
  ttl_seconds: 259200  # 3 days

# Modular action system - users can configure additional actions
actions:
  enabled: true
  modules:
    - name: "twitter"
      enabled: false
      config:
        api_key_env: "TWITTER_API_KEY"
        template: "🚀 Just released {version}! {summary}"
    - name: "slack"
      enabled: false
      config:
        webhook_env: "SLACK_WEBHOOK_URL"
        channel: "#releases"
    - name: "custom-webhook"
      enabled: false
      config:
        url_env: "CUSTOM_WEBHOOK_URL"
        method: "POST"
        headers:
          Content-Type: "application/json"
```

---

## 5 — Tone management & prompt templates

### 5.1 Tone Presets Directory Structure

```
tones/
├── concise.md          # Short, technical descriptions
├── friendly.md         # Casual, approachable language  
├── formal.md           # Professional, enterprise tone
├── detailed.md         # Comprehensive explanations
└── custom/
    ├── startup.md      # Example: energetic startup tone
    ├── enterprise.md   # Example: conservative enterprise tone
    └── open-source.md  # Example: community-focused tone
```

### 5.2 Tone File Format

Each tone file contains system prompts and examples:

```markdown
# Tone: Concise
**Personality:** Direct, technical, no fluff
**Target Audience:** Experienced developers
**Example Bullets:**
- Fix memory leak in parser (#123)
- Add OAuth2 support (#124)
- Update deps to latest versions (#125)
```

### 5.3 Prompt Templates (recommended)

#### System prompt (short)

```
You are an expert release-note writer for developer tools. Produce concise, readable, and accurate changelog sections using the structured JSON schema requested. Do NOT include any confidential secrets or full code diffs unless explicitly told. Provide both customer-facing notes and developer upgrade notes when requested.
```

#### User prompt (structured, instruct Claude to produce JSON + markdown)

```
Input: a list of changes (commits or PRs) with fields: id, type, title, body, labels, author, linkedIssues.
Task: Group the changes into these sections: [list sections from config]. For each change, produce a 1–2 sentence customer-facing bullet. Create a separate "Developer Notes" section containing breaking changes and migration steps.

Output requirements:
1) Provide a top-level JSON object exactly matching this schema:
{
  "release_title": "<text>",
  "sections": [
    {
      "id": "<section_id>",
      "title": "<section title>",
      "items": [
        { "id":"<id>", "short":"<one-line customer bullet>", "pr":"<PR link or null>", "why":"<1-sentence why-it-matters optional>"}
      ]
    }
  ],
  "developer_notes": [ {"type":"breaking", "desc":"...","migration":"..."} ],
  "summary": "<3-sentence plain text summary>"
}

2) After JSON, append a markdown version of the changelog suitable for inclusion in CHANGELOG.md (h1/h2 and bullets).
3) If you detect possible PII in the body, set a field developer_notes.suspect_pii = true and flag the items.
4) Keep bullets short and avoid internal-only jargon — if a term appears internal, keep it but mark developer_notes.suspect_jargon=true.

Input data:
<<INJECT REDACTED CHANGES JSON>>
```

(Implement code to validate JSON output with a strict schema; if Claude returns text, parse and validate; if validation fails, retry once with a short retry-system-prompt.)

---

## 6 — Example TypeScript integration snippet (Action / CLI use)

**Key points:** use the `query` function from `@anthropic-ai/claude-code`. The SDK returns an async iterator of messages. Supply auth via env var (ANTHROPIC\_API\_KEY or CLAUDE\_CODE\_OAUTH\_TOKEN).

```ts
import { query } from "@anthropic-ai/claude-code";

async function generateReleaseNotes(prompt: string, options = {}) {
  const messages = [];
  for await (const msg of query({
    prompt,
    options: {
      systemPrompt: "You are an expert release-note writer...",
      maxTurns: 1,
      // allowedTools: ["Read"] // only if you need tools
    }
  })) {
    if (msg.type === "result") {
      return msg.result; // string with the JSON + markdown
    }
  }
  throw new Error("Claude produced no result");
}
```

(See SDK docs for `query` usage and streaming iterator semantics.) ([Anthropic][1])

**Auth note:** the SDK will prefer `ANTHROPIC_API_KEY`. Claude Code setup also supports Anthropic Console OAuth flow (user environment), so the Action supports either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. ([Anthropic][1])

---

## 7 — GitHub Action workflow (example)

```yaml
name: Qyx Change - Release Notes
on:
  release:
    types: [published]
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Qyx Change
        uses: qyxdev/qyx-change-action@v0
        with:
          changelog_path: CHANGELOG.md
          create_pr: "true"
        env:
          # Provided by repo maintainers
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The Action will write a preview artifact `release-preview.md`. Use GitHub Actions cache to store prompt/result cache keyed by commit SHAs to avoid repeated LLM calls.

---

## 8 — Caching, rate-limiting, retries

* Cache results keyed by `(generator, commit_sha_range, tone, sections)`. Use GitHub Actions cache or `.qyx-cache` file in repo (ignored).
* Retries: exponential backoff on 429/5xx up to 3 attempts.
* If LLM fails, fallback to deterministic templating:

  * Group items by label → generate bullets with `- <PR-title> (#123)` — deterministic and safe.

---

## 9 — Security & privacy checklist (must-have)

* **Secrets**: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` must only be provided via GitHub Secrets and never printed to logs.
* **Redaction by default**: never send full diffs or secrets unless explicitly enabled by the repo admin.
* **Audit logs**: Action produces `delta.json` artifact (sensitive? put behind `retention-days` or delete).
* **Local config storage**: CLI stores tokens only in OS keychain or `~/.qyx-change/config` with clear instructions to avoid plaintext (or recommend `claude setup-token` for long-lived tokens). Community examples show `claude setup-token` can create long-lived tokens; support storing `CLAUDE_CODE_OAUTH_TOKEN` if user chooses. ([Answer Overflow][3], [GitHub][4])
* **Licensing**: MIT by default. Contributor CLA not required (optional).

---

## 10 — Tests & quality

* Unit tests:

  * Parsing of conventional commits.
  * Mapping labels → sections.
  * Redaction module with test vectors.
* Integration tests (CI):

  * Mocked Claude SDK (stub `query`) to validate prompt/response parsing.
  * End-to-end tests with a small sample repo (no secrets).
* Linting/formatting, and pre-commit hooks.

---

## 11 — Repo layout (deliverables)

```
qyx-change/
├─ .github/workflows/ci.yml
├─ action.yml
├─ src/
│  ├─ index.ts          # action entry
│  ├─ cli.ts
│  ├─ domains/          # domain-driven design structure
│  │  ├─ collection/    # git/GitHub data collection
│  │  ├─ normalization/ # data processing & structuring
│  │  ├─ generation/    # Claude SDK integration
│  │  ├─ output/        # changelog writing & actions
│  │  └─ shared/        # shared types & utilities
│  ├─ lib/
│  │  ├─ collector.ts   # git/GitHub APIs
│  │  ├─ normalizer.ts
│  │  ├─ redactor.ts
│  │  ├─ generator.ts   # Claude SDK wrapper
│  │  ├─ writer.ts      # changelog writer
│  │  ├─ cache.ts
│  │  └─ actions/       # modular action system
│  │     ├─ twitter.ts
│  │     ├─ slack.ts
│  │     └─ webhook.ts
├─ tones/               # tone management
│  ├─ concise.md
│  ├─ friendly.md
│  ├─ formal.md
│  ├─ detailed.md
│  └─ custom/
│     └─ example.md
├─ prompts/
│  └─ release.prompts.md
├─ templates/
│  └─ changelog.hbs
├─ test/
├─ docs/                # excessive documentation
│  ├─ architecture.md
│  ├─ modules/
│  └─ examples/
├─ README.md
├─ LICENSE (MIT)
├─ CONTRIBUTING.md
└─ .qyx-change.yml.example
```

---

## 12 — Acceptance criteria (MVP)

* [ ] `qyx-change` CLI runs locally, producing a `CHANGELOG.md` using local git commits and user-provided `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.
* [ ] GitHub Action runs on `release.published` and produces `release-preview.md` artifact and (optionally) opens a PR with `CHANGELOG.md`.
* [ ] By default, no diffs or secrets are sent to Claude; only PR title/body and truncated body are sent.
* [ ] JSON schema validation of Claude output; fallback deterministic output if validation fails.
* [ ] Comprehensive README + config example + MIT license.

---

## 13 — Roadmap / next-phase features

* Tone presets and localized translations.
* Notion/Confluence integrations (user OAuth tokens stored in GitHub Secrets).
* Web preview UI (self-hostable) that renders artifacts and allows maintainers to manually merge.
* Auto-detect breaking changes from commits & run a simple “impact” test (CI checks) to attach to release notes.
* Link Qyx Change to Qyx Patch (automatically link fix PRs).
* Community-contributed “changelog templates” per ecosystem (npm, Python, Rust) and release styles (semantic, customer-facing).

---

## 14 — Developer & contributor notes

* Use `@anthropic-ai/claude-code` for generation calls. The SDK provides the `query` function and streaming iterator for programmatic usage. Use `--output-format json` mode when calling the `claude` CLI as an alternate path. ([Anthropic][1])
* For OAuth flows: the Claude Code setup supports the Anthropic Console OAuth process (Anthropic Console option) and the community has tooling/recipes for storing long-lived tokens for automation. Document both approaches: `ANTHROPIC_API_KEY` (recommended for long-running automation) and `CLAUDE_CODE_OAUTH_TOKEN` (when user has OAuth token). ([Anthropic][5], [Answer Overflow][3])

---

## 15 — Example input → output

**Input (parsed):**

```json
[
  {"id":"#345","type":"feat","title":"Add SAML login","labels":["feature","auth"],"body":"Add SAML support with config X","author":"alice"},
  {"id":"#350","type":"fix","title":"Fix CSV upload crash","labels":["bug"], "body":"Null pointer when field empty"}
]
```

**Desired JSON output (from Claude):**

```json
{
  "release_title":"v1.2.0 — 2025-08-16",
  "sections":[
    {"id":"features","title":"🚀 Features","items":[{"id":"#345","short":"Add SAML single-sign-on support (#345) — enables enterprise logins.","pr":"https://github.com/.../pull/345"}]},
    {"id":"fixes","title":"🛠 Fixes","items":[{"id":"#350","short":"Fix crash on CSV uploads when an optional field is empty (#350).","pr":"https://github.com/.../pull/350"}]}
  ],
  "developer_notes":[{"type":"none","desc":"","migration":""}],
  "summary":"Two changes: SAML login and a CSV upload crash fix. Enterprise users can now use SAML."
}
```

**Markdown snippet appended to CHANGELOG.md:**

```md
## v1.2.0 — 2025-08-16

### 🚀 Features
- Add SAML single-sign-on support (#345). Enables enterprise logins.

### 🛠 Fixes
- Fix crash on CSV uploads when an optional field is empty (#350).

**Summary:** Two changes: SAML login and a CSV upload crash fix.
```

---

## 16 — Final notes & next steps I’ll do for you if you want

I can immediately (pick one or more and I’ll produce runnable artifacts right here):

* A. **Generate the GitHub Action** code (`action.yml`, `Dockerfile`, `entrypoint.ts`) + `package.json` and a basic implementation of `collector.ts`, `normalizer.ts`, and `generator.ts` that calls `@anthropic-ai/claude-code` (with the prompt template above).
* B. **Create the CLI** (TypeScript) with `qyx-change generate` + `release` commands and example `.qyx-change.yml`.
* C. **Write the README + CONTRIBUTING.md + MIT LICENSE** and the `.github/workflows/ci.yml` to run tests.
* D. **Draft the “Add to GitHub” landing page snippet** for qyx.dev (marketing + install flow).

Say which artifact to produce first (Action code, CLI, or README + docs) and I’ll output the files you can paste/run. I won’t host keys or services — the output will be fully runnable locally or in GitHub Actions using the user’s Anthropic/Claude token.

---

### References (important docs I used)

* Claude Code SDK docs (query function and SDK basics). ([Anthropic][1])
* Claude Code setup page (shows Anthropic Console OAuth option in setup). ([Anthropic][5])
* CLI reference (supports `--output-format json` useful for automation). ([Anthropic][2])
* Community notes/examples about storing OAuth tokens / `CLAUDE_CODE_OAUTH_TOKEN` workflows. ([Answer Overflow][3], [GitHub][4])

---

[1]: https://docs.anthropic.com/en/docs/claude-code/sdk "Claude Code SDK - Anthropic"
[2]: https://docs.anthropic.com/en/docs/claude-code/cli-reference "CLI reference - Anthropic"
[3]: https://www.answeroverflow.com/m/1404654368745193492?utm_source=chatgpt.com "Claude Code module authentication with Claude Code Subscription"
[4]: https://github.com/grll/claude-code-login?utm_source=chatgpt.com "grll/claude-code-login - GitHub"
[5]: https://docs.anthropic.com/en/docs/claude-code/setup "Set up Claude Code - Anthropic"
