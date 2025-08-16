# Qyx Change

> Automatically generate beautiful, human-friendly release notes and changelogs from your repository's commits and pull requests using Claude Code AI Agent.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Actions](https://img.shields.io/github/workflow/status/qyx/change/CI)](https://github.com/qyx/change/actions)
[![npm version](https://img.shields.io/npm/v/qyx-change.svg)](https://www.npmjs.com/package/qyx-change)

## ✨ Features

- **🤖 AI-Powered**: Uses Claude Code to generate intelligent, context-aware release notes
- **🔒 Privacy-First**: Runs in your environment with your API keys - no data sent to external services
- **🧩 Modular Actions**: Configure Twitter posts, Slack notifications, webhooks, and more
- **🎨 Customizable Tones**: Built-in tone presets (concise, friendly, formal) or create custom tones
- **⚡ Fast & Cached**: Smart caching to avoid duplicate API calls
- **🛡️ Security**: Automatic redaction of secrets and sensitive information
- **📦 Easy Setup**: Works as CLI tool or GitHub Action

## 🚀 Quick Start

### CLI Installation

```bash
npm install -g qyx-change
```

### Basic Usage

```bash
# Generate changelog for recent commits
qyx-change generate

# Create a release with changelog
qyx-change release --tag v1.2.0 --push

# Preview mode (opens editor)
qyx-change generate --preview
```

### GitHub Action

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

## ⚙️ Configuration

Create `.qyx-change.yml` in your repository root:

```yaml
# Basic configuration
generator: claude-code
auth:
  mode: auto  # auto | api-key | oauth

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
  tone_preset: "concise"  # concise | friendly | formal | detailed | custom
  tone_file: "tones/custom.md"  # when tone_preset is 'custom'
  include_developer_notes: true

# Modular actions - configure integrations
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
```

## 🎨 Custom Tones

Create your own tone files in the `tones/` directory:

```markdown
# Tone: Startup Energy
**Personality:** Energetic, exciting, emoji-heavy
**Target Audience:** Users and potential customers
**Example Bullets:**
- 🎉 Launched amazing OAuth2 support - authenticate in seconds! (#124)
- ⚡ Supercharged our parser - 50% faster processing! (#123)
- 🐛 Squashed pesky memory leak - smooth sailing ahead! (#125)
```

Available tone presets:
- **concise**: Direct, technical descriptions for developers
- **friendly**: Casual, approachable language with personality
- **formal**: Professional, enterprise-appropriate tone
- **detailed**: Comprehensive explanations with context

## 🔑 Authentication

### Option 1: Anthropic API Key (Recommended)
```bash
export ANTHROPIC_API_KEY="your_api_key_here"
```

### Option 2: Claude Code OAuth Token
```bash
# Set up Claude Code OAuth (interactive)
claude setup-token

# Use the token
export CLAUDE_CODE_OAUTH_TOKEN="your_oauth_token"
```

## 📖 Documentation

- [🏗️ Architecture Overview](docs/architecture.md)
- [🧩 Module System](docs/modules/)
- [🎨 Custom Tones Guide](docs/tones.md)
- [🔒 Security & Privacy](docs/security.md)
- [🚀 Examples & Recipes](docs/examples/)

## 🛡️ Security & Privacy

Qyx Change prioritizes your security:

- **No external services**: Everything runs in your environment
- **Automatic redaction**: Removes API keys, secrets, and sensitive data
- **Optional data sharing**: Full diffs are never sent unless explicitly enabled
- **Local caching**: Results cached locally, not on external servers

## 🧩 Extensibility

### Custom Actions

Create custom action modules in `src/lib/actions/`:

```typescript
// src/lib/actions/discord.ts
export interface DiscordConfig {
  webhook_env: string;
  username?: string;
}

export async function executeDiscordAction(
  release: ReleaseData,
  config: DiscordConfig
): Promise<void> {
  const webhook = process.env[config.webhook_env];
  // Implementation...
}
```

### Domain-Driven Architecture

```
src/
├── domains/
│   ├── collection/     # Git/GitHub data gathering
│   ├── normalization/  # Data processing & structure
│   ├── generation/     # Claude Code integration
│   ├── output/         # Changelog writing & actions
│   └── shared/         # Common types & utilities
```

## 🤝 Contributing

We follow domain-driven design and prioritize thorough documentation:

1. **Modularity**: Every component should be independently testable
2. **Documentation**: Document everything - APIs, examples, decisions
3. **Domain Boundaries**: Respect the separation between collection, processing, generation, and output

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📋 Examples

### Input (Git commits/PRs)
```json
[
  {
    "id": "#345",
    "type": "feat",
    "title": "Add SAML login support",
    "labels": ["feature", "auth"],
    "body": "Implement SAML SSO with configurable providers"
  },
  {
    "id": "#350",
    "type": "fix",
    "title": "Fix CSV upload crash",
    "labels": ["bug"],
    "body": "Handle null values in optional fields"
  }
]
```

### Output (Generated Changelog)
```markdown
## v1.2.0 — 2025-08-16

### 🚀 Features
- Add SAML single-sign-on support (#345). Enables enterprise authentication with configurable identity providers.

### 🛠 Fixes
- Fix crash during CSV uploads when optional fields contain null values (#350).

**Summary:** Enhanced authentication capabilities and improved data import reliability.
```

## 🗺️ Roadmap

- [ ] **v1.0**: Core CLI + GitHub Action with basic tone presets
- [ ] **v1.1**: Advanced action modules (Twitter, Slack, Notion)
- [ ] **v1.2**: Web preview UI for manual review
- [ ] **v1.3**: Breaking change detection and impact analysis
- [ ] **v2.0**: Integration with Qyx Patch for automated fix linking

## 📄 License

MIT © [Qyx](https://qyx.dev)

## 🆘 Support

- 📖 [Documentation](docs/)
- 🐛 [Issues](https://github.com/qyx/change/issues)
- 💬 [Discussions](https://github.com/qyx/change/discussions)
- 🔗 [Qyx Community](https://qyx.dev/community)

---

<p align="center">
  <strong>Built with ❤️ by the Qyx team</strong><br>
  <em>Making software releases more human</em>
</p>