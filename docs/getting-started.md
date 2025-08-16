# Getting Started with Qyx Change

Qyx Change is an AI-powered tool that automatically generates beautiful, human-friendly release notes and changelogs from your repository's commits and pull requests using Claude Code AI.

## Quick Start

### 1. Installation

```bash
# Install globally via npm
npm install -g qyx-change

# Or use via npx (no installation required)
npx qyx-change --help
```

### 2. Setup Authentication

Qyx Change uses Claude Code AI, so you need an Anthropic API key:

```bash
# Get your API key from https://console.anthropic.com/
export ANTHROPIC_API_KEY="your_api_key_here"

# For GitHub integration (optional but recommended):
export GITHUB_TOKEN="your_github_token"
```

### 3. Basic Usage

```bash
# Generate changelog for recent commits
qyx-change generate

# Generate changelog since a specific tag
qyx-change generate --since v1.0.0

# Preview before writing (opens in editor)
qyx-change generate --preview

# Create a release with changelog
qyx-change release --tag v1.2.0 --push
```

## Configuration

Create a `.qyx-change.yml` file in your repository root:

```yaml
# Basic configuration
generator: claude-code
auth:
  mode: auto

format:
  changelog_path: CHANGELOG.md
  sections:
    - name: "🚀 Features"
      labels: ["feature", "feat"]
    - name: "🛠 Fixes"  
      labels: ["bug", "fix"]
    - name: "⚡ Performance"
      labels: ["perf"]

generation:
  tone_preset: "concise"  # concise | friendly | formal | detailed
  include_developer_notes: true
```

## GitHub Action

Add to `.github/workflows/release.yml`:

```yaml
name: Release Notes
on:
  release:
    types: [published]

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate Release Notes
        uses: qyxdev/qyx-change-action@v1
        with:
          changelog_path: CHANGELOG.md
          create_pr: "true"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Examples

### Input (Git commits/PRs)
```
feat: Add SAML login support (#345)
fix: Fix CSV upload crash (#350)  
perf: Optimize database queries (#351)
```

### Output (Generated Changelog)
```markdown
## v1.2.0 — 2025-08-16

### 🚀 Features
- Add SAML single-sign-on support (#345). Enables enterprise authentication with configurable identity providers.

### 🛠 Fixes
- Fix crash during CSV uploads when optional fields contain null values (#350).

### ⚡ Performance
- Optimize database query performance for better response times (#351).

**Summary:** Enhanced authentication capabilities, improved data import reliability, and better performance.
```

## Key Features

- **🤖 AI-Powered**: Uses Claude Code to generate intelligent, context-aware release notes
- **🔒 Privacy-First**: Runs in your environment with your API keys - no data sent to external services
- **🎨 Customizable Tones**: Built-in tone presets (concise, friendly, formal, detailed) or create custom tones
- **⚡ Fast & Cached**: Smart caching to avoid duplicate API calls
- **🛡️ Security**: Automatic redaction of secrets and sensitive information
- **📦 Easy Setup**: Works as CLI tool or GitHub Action

## Next Steps

- Read the [full documentation](docs/)
- Check out [configuration examples](docs/examples/)
- Learn about [custom tones](docs/tones.md)
- Explore [security features](docs/security.md)