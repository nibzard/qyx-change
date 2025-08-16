# Qyx Change

> 🚀 **Production-Ready** AI-powered changelog generator that creates beautiful, human-friendly release notes from your repository's commits and pull requests using Claude Code AI.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/qyx/change/actions)

## ✨ Features

- **🤖 AI-Powered**: Uses Claude Code SDK to generate intelligent, context-aware release notes
- **🎯 Interactive Preview**: Review and edit changelogs before publishing with built-in editor support  
- **🔒 Privacy-First**: Runs locally with automatic redaction of secrets and sensitive data
- **📝 Smart Configuration**: Comprehensive validation with helpful error messages
- **🎨 Tone Customization**: Built-in presets (concise, friendly, formal, detailed) or custom tones
- **⚡ Performance**: Smart caching and efficient processing with fallback mechanisms
- **🔧 GitHub Integration**: Full GitHub Actions support with PR creation and commit automation
- **📦 Multiple Interfaces**: CLI tool, GitHub Action, or programmatic API

## 🚀 Quick Start

### CLI Installation

```bash
npm install -g qyx-change
```

### Basic Usage

```bash
# Generate changelog with interactive preview
qyx-change generate --preview

# Generate and save changelog directly  
qyx-change generate

# Create a release with changelog and push to GitHub
qyx-change release --tag v1.2.0 --push

# Dry run to see what would be generated
qyx-change generate --dry-run --verbose
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
          commit_changes: "true"
          create_pr: "true" 
          update_release: "true"
          tone_preset: "friendly"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Programmatic API

```typescript
import { QyxChange, DEFAULT_CONFIG } from 'qyx-change';

const qyx = new QyxChange(DEFAULT_CONFIG);

// Generate changelog data
const result = await qyx.generateChangelog({
  since: 'v1.0.0',
  version: 'v1.1.0'
});

// Generate and write changelog file
const fullResult = await qyx.generateAndWriteChangelog({
  version: 'v1.1.0'
});

console.log(`Generated ${fullResult.metadata.changesCount} changes`);
```

## ⚙️ Configuration

Create `.qyx-change.yml` in your repository root:

```yaml
# Core configuration
generator: claude-code
auth:
  mode: auto  # auto | api-key | oauth

# Changelog formatting
format:
  changelog_path: CHANGELOG.md
  sections:
    - name: "🚀 Features"
      labels: ["feature", "feat"]
    - name: "🛠 Fixes"  
      labels: ["bug", "fix"]
    - name: "⚡ Performance"
      labels: ["perf"]
    - name: "🔒 Security"
      labels: ["security"]
  max_items_per_section: 20
  include_pr_links: true

# AI generation settings
generation:
  tone_preset: "concise"  # concise | friendly | formal | detailed | custom
  tone_file: "tones/custom.md"  # when tone_preset is 'custom'
  locale: "en-US"
  include_developer_notes: true
  send_diff_snippets: false  # Security: keep disabled

# Privacy & security
redaction:
  redact_patterns:
    - "api_?key"
    - "secret"
    - "password" 
    - "token"
  email_mask: true
  trunc_body_to: 300

# Performance
cache:
  enabled: true
  ttl_seconds: 259200  # 3 days

# Future: Modular actions for integrations
actions:
  enabled: false
  modules: []
```

The configuration is automatically validated on startup with helpful error messages.

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

### GitHub Integration (Optional)
```bash
# For enhanced PR/issue data and release creation
export GITHUB_TOKEN="your_github_token"
export GITHUB_REPOSITORY="owner/repo"  # Auto-detected in GitHub Actions
```

## 🎯 Interactive Features

### Preview Mode
```bash
# Interactive preview with editor support
qyx-change generate --preview
```

The preview mode offers:
- ✅ **Accept**: Save the generated changelog
- ✏️ **Edit**: Open in your preferred editor ($EDITOR)
- 🔄 **Regenerate**: Try different settings
- ❌ **Cancel**: Exit without saving

### Configuration Validation
Comprehensive validation with clear error messages:
```bash
❌ Auth mode is required
⚠️ GITHUB_TOKEN not set. GitHub integration will be limited.
✅ Configuration loaded and validated
```

## 🛡️ Security & Privacy

Security-first design with comprehensive protection:

- **🏠 Local Execution**: Everything runs in your environment - no external services
- **🔒 Automatic Redaction**: Removes API keys, secrets, passwords, and sensitive data
- **📊 Privacy Controls**: Diff snippets never sent unless explicitly enabled
- **💾 Local Caching**: Results cached locally, not on external servers
- **✅ Pattern Detection**: Configurable redaction patterns with smart defaults
- **📧 Email Masking**: Automatically masks email addresses in commit data

## 🏗️ Architecture & Development

### Domain-Driven Design
```
src/
├── domains/
│   ├── collection/     # Git/GitHub data gathering
│   ├── normalization/  # Data processing & structure  
│   ├── generation/     # Claude Code AI integration
│   ├── output/         # Changelog writing & GitHub releases
│   └── shared/         # Types, config, validation, errors
├── cli.ts              # Command-line interface
├── action.ts           # GitHub Action runner
└── index.ts            # Programmatic API
```

### Development Setup
```bash
git clone <repository>
cd qyx-change
npm install

# Development
npm run dev -- generate --help
npm run build
npm run test
npm run lint
```

## 🔍 How It Works

1. **📥 Collection**: Gathers commits and PR data from Git and GitHub APIs
2. **🔄 Normalization**: Deduplicates, categorizes, and cleans the data  
3. **🤖 Generation**: Uses Claude Code AI to create human-friendly release notes
4. **📤 Output**: Writes formatted changelog and optionally creates GitHub releases

Each domain is independently testable with clear boundaries and responsibilities.

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

## ✅ Current Status

**v0.1.0** - Production Ready Core Features:
- ✅ Complete CLI with interactive preview and editor support
- ✅ Full GitHub Action with commit automation and PR creation
- ✅ Comprehensive configuration validation and error handling
- ✅ AI-powered generation with Claude Code SDK + fallback
- ✅ Security-first privacy protection and automatic redaction
- ✅ Domain-driven architecture with full TypeScript support
- ✅ Programmatic API for custom integrations

## 🗺️ Roadmap

- [ ] **v1.0**: Performance optimizations and extended testing
- [ ] **v1.1**: Advanced action modules (Slack, Discord, webhooks)
- [ ] **v1.2**: Breaking change detection and migration guides  
- [ ] **v1.3**: Web UI for changelog preview and editing
- [ ] **v2.0**: Multi-repository monorepo support

## 📄 License

MIT © [Qyx](https://qyx.dev)

## 🆘 Support & Contributing

- 🐛 [Report Issues](https://github.com/qyx/change/issues)  
- 💬 [Discussions](https://github.com/qyx/change/discussions)
- 📖 [Documentation](docs/)
- 🤝 [Contributing Guidelines](CONTRIBUTING.md)

## 🙏 Acknowledgments

- **Claude Code AI** - For intelligent changelog generation
- **TypeScript Community** - For excellent tooling and type safety
- **GitHub** - For comprehensive Git and PR APIs  
- **Open Source** - For the foundation this project builds upon

---

<p align="center">
  <strong>🚀 Built with Claude Code AI</strong><br>
  <em>Making software releases more human</em>
</p>