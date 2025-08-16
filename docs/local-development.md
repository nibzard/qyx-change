# Local Development Setup

## Environment Variables

Qyx Change supports multiple authentication methods. Create a `.env.local` file in the project root:

```bash
# Copy the example file
cp .env.example .env.local
```

Then add your credentials to `.env.local`:

### Option 1: Claude Code OAuth Token (Recommended)

If you have Claude Code installed, you can use OAuth authentication:

```bash
# First, set up Claude Code OAuth token
claude setup-token

# Then add to .env.local:
CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token_here
```

### Option 2: Anthropic API Key

Alternatively, use a direct API key from Anthropic Console:

```bash
# Get your API key from https://console.anthropic.com/
# Add to .env.local:
ANTHROPIC_API_KEY=your_api_key_here
```

### Optional: GitHub Token

For enhanced PR and issue data:

```bash
# Get token from https://github.com/settings/tokens
# Add to .env.local:
GITHUB_TOKEN=your_github_token_here
```

## Testing Locally

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Link for global CLI testing
npm link

# Test with dry-run (no files changed)
qyx-change generate --dry-run --verbose

# Test with actual generation
qyx-change generate --since HEAD~5

# Test release command
qyx-change release --tag v0.1.0 --dry-run
```

## Authentication Precedence

The tool checks for authentication in this order:

1. `CLAUDE_CODE_OAUTH_TOKEN` (if available)
2. `ANTHROPIC_API_KEY` (fallback)
3. Deterministic generation (if no AI credentials)

## Example .env.local File

```bash
# Claude Code OAuth (preferred)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-abc123...

# GitHub integration (optional)
GITHUB_TOKEN=ghp_abc123...

# For testing GitHub Actions locally
GITHUB_REPOSITORY=owner/repo
```

## Troubleshooting

### "Configuration file not found"
- Make sure you're in a directory with a `.qyx-change.yml` file, or the tool will use defaults

### "Not a git repository"
- The tool requires a git repository to analyze commits
- Run `git init` and make some commits to test

### "No changes found"
- Use `--since` to specify a commit range: `qyx-change generate --since HEAD~10`
- Check that you have commits in your repository

### "Claude API call failed"
- Verify your `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is correct
- The tool will fall back to deterministic generation if AI fails