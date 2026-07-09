# Obsidian Confluence Git Sync

> **Write in Obsidian. Source of truth in Git. Published to Confluence.**

An Obsidian plugin that bridges three worlds: your local vault (authoring), GitHub (version control), and Confluence (team publishing). Unlike existing plugins that only convert Markdown to Confluence format, this one manages the **full lifecycle**: idempotent publishing, git integration, frontmatter-to-labels mapping, wiki-link resolution, and CI/CD via GitHub Actions.

## Features

- **Idempotent publishing** — publish a note to Confluence; if a page with the same title exists, it updates it. No duplicates.
- **Git integration** — commit and push directly from Obsidian using `isomorphic-git` (no CLI needed).
- **Frontmatter → Confluence properties** — `tags: [prd, b-1]` become Confluence labels; `status: draft` becomes a page property.
- **Wiki-link resolution** — `[[B-3-vizix-discrepancy-mcp]]` becomes a link to the corresponding Confluence page.
- **Batch publish** — publish all notes matching a pattern (e.g. `prds/B-*.md`) in one command.
- **Dry-run preview** — see what would change before publishing.
- **GitHub Actions template** — generates `.github/workflows/publish.yml` so your CI publishes on every push to `main`.
- **Multi-space mapping** — map different vault folders to different Confluence spaces.

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings → Community plugins
2. Search for "Confluence Git Sync"
3. Click Install, then Enable

### Manual installation

1. Download the latest release from [GitHub releases](https://github.com/DIAL-Studio/obsidian-confluence-git-sync/releases)
2. Extract to `{your-vault}/.obsidian/plugins/confluence-git-sync/`
3. Restart Obsidian and enable the plugin

## Setup

1. Open Settings → Confluence Git Sync
2. Fill in your Confluence connection:
   - **Base URL**: `https://your-domain.atlassian.net/wiki`
   - **Email**: your Atlassian account email
   - **API Token**: generate one at https://id.atlassian.com/manage-profile/security/api-tokens
   - **Space Key**: e.g. `YD`, `ENG`
   - **Parent Page ID**: the page under which new pages will be created
3. (Optional) Configure Git:
   - **Repo path**: local path to your git repository
   - **Branch**: `main`
   - **GitHub token (for push)**: personal access token with repo scope (generate at https://github.com/settings/tokens)
   - **Auto-commit on publish**: yes/no
4. (Optional) Configure file patterns:
   - **Include pattern**: `prds/B-*.md`
   - **Folder → Space mapping**: `prds/ → YD`, `docs/ → ENG`

## Usage

### Commands (Cmd/Ctrl+P)

| Command | Description |
|---------|-------------|
| `Confluence Git Sync: Publish current note` | Publish the active note to Confluence |
| `Confluence Git Sync: Publish all` | Publish all notes matching the include pattern |
| `Confluence Git Sync: Publish and commit` | Publish + git commit + push to remote |
| `Confluence Git Sync: Dry-run` | Preview what would change |
| `Confluence Git Sync: Open current note in Confluence` | Open the published Confluence page for the current note |
| `Confluence Git Sync: Show published references` | List all notes with Confluence URLs in the console |
| `Confluence Git Sync: Copy last published link` | Copy the URL of the last published page |
| `Confluence Git Sync: Generate GitHub Action` | Create `.github/workflows/publish.yml` |

### Keyboard shortcuts

Assign hotkeys in Obsidian Settings → Hotkeys → search "Confluence Git Sync".

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  Obsidian   │ ──► │  Git (local) │ ──► │   GitHub   │
│  (author)   │     │  commit+push │     │ (source of │
│             │     │              │     │  truth)    │
└──────┬──────┘     └──────────────┘     └──────┬─────┘
       │                                        │
       │  plugin publish                        │  GitHub Action
       ▼                                        ▼
┌─────────────┐                        ┌────────────────┐
│  Confluence │                        │  Confluence    │
│  (manual)   │                        │  (auto on push)│
└─────────────┘                        └────────────────┘
```

## Development

```bash
# Clone
git clone https://github.com/DIAL-Studio/obsidian-confluence-git-sync.git
cd obsidian-confluence-git-sync

# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Watch mode
npm run dev
```

### Project structure

```
confluence-git-sync/
├── src/
│   ├── main.ts                 # Plugin entry point
│   ├── md-to-confluence.ts     # Markdown → Storage Format converter
│   ├── frontmatter-parser.ts   # YAML → Confluence properties/labels
│   ├── wiki-link-resolver.ts   # [[links]] → Confluence page links
│   ├── idempotent-publisher.ts # Match by title or page ID → update or create
│   ├── git-bridge.ts           # isomorphic-git wrapper (commit + push)
│   ├── vault-fs-adapter.ts     # Vault adapter for isomorphic-git (bypasses sandboxed fs)
│   └── github-actions-gen.ts   # Generate .github/workflows/publish.yml
├── tests/
│   ├── md-to-confluence.test.ts
│   ├── frontmatter-parser.test.ts
│   ├── wiki-link-resolver.test.ts
│   └── idempotent-publisher.test.ts
├── test-samples/
│   ├── sample-prd.md
│   └── expected-confluence.xml
├── .github/workflows/
│   └── publish.yml             # Template generated by the plugin
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

## Comparison with existing plugins

| Feature | `obsidian-confluence-converter` | `confluence-link` | **`confluence-git-sync`** |
|---------|------|------|------|
| Markdown → Confluence | ✅ (clipboard) | ✅ (direct) | ✅ (direct) |
| Idempotent (update if exists) | ❌ | ❌ | ✅ |
| Git integration | ❌ | ❌ | ✅ |
| GitHub Actions template | ❌ | ❌ | ✅ |
| Frontmatter → labels | ❌ | ❌ | ✅ |
| Wiki-link resolution | ❌ | ❌ | ✅ |
| Batch publish | ❌ | ❌ | ✅ |
| Dry-run preview | ❌ | ❌ | ✅ |
| Multi-space mapping | ❌ | ❌ | ✅ |

## License

MIT

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

- [ ] v0.1: Core converter (Markdown → Storage Format)
- [ ] v0.2: Idempotent publisher (create/update pages)
- [ ] v0.3: Frontmatter parser (tags → labels, properties)
- [ ] v0.4: Wiki-link resolver
- [ ] v0.5: Git integration (commit + push)
- [ ] v0.6: GitHub Actions template generator
- [ ] v0.7: Multi-space mapping
- [ ] v0.8: Batch publish + dry-run
- [ ] v1.0: Stable release with tests and docs