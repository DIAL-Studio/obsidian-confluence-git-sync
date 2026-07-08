import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TFolder } from "obsidian";
import { MdToConfluenceConverter } from "./md-to-confluence";
import { FrontmatterParser } from "./frontmatter-parser";
import { WikiLinkResolver } from "./wiki-link-resolver";
import { IdempotentPublisher } from "./idempotent-publisher";
import { GitBridge } from "./git-bridge";
import { GithubActionsGen } from "./github-actions-gen";

interface ConfluenceGitSyncSettings {
  confluenceBaseUrl: string;
  confluenceEmail: string;
  confluenceApiToken: string;
  confluenceSpaceKey: string;
  confluenceParentPageId: string;
  gitRepoPath: string;
  gitBranch: string;
  autoCommitOnPublish: boolean;
  includePattern: string;
  folderSpaceMappings: Record<string, string>;
}

const DEFAULT_SETTINGS: ConfluenceGitSyncSettings = {
  confluenceBaseUrl: "",
  confluenceEmail: "",
  confluenceApiToken: "",
  confluenceSpaceKey: "",
  confluenceParentPageId: "",
  gitRepoPath: "",
  gitBranch: "main",
  autoCommitOnPublish: false,
  includePattern: "*.md",
  folderSpaceMappings: {},
};

export default class ConfluenceGitSyncPlugin extends Plugin {
  settings: ConfluenceGitSyncSettings;
  private converter: MdToConfluenceConverter;
  private frontmatterParser: FrontmatterParser;
  private wikiLinkResolver: WikiLinkResolver;
  private publisher: IdempotentPublisher;
  private gitBridge: GitBridge;
  private githubActionsGen: GithubActionsGen;

  async onload() {
    await this.loadSettings();

    this.converter = new MdToConfluenceConverter();
    this.frontmatterParser = new FrontmatterParser();
    this.wikiLinkResolver = new WikiLinkResolver();
    this.publisher = new IdempotentPublisher(
      this.settings.confluenceBaseUrl,
      this.settings.confluenceEmail,
      this.settings.confluenceApiToken,
      this.settings.confluenceSpaceKey,
      this.settings.confluenceParentPageId
    );
    this.gitBridge = new GitBridge(this.settings.gitRepoPath);
    this.githubActionsGen = new GithubActionsGen();

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note",
      callback: () => this.publishCurrentNote(),
    });

    this.addCommand({
      id: "publish-all",
      name: "Publish all",
      callback: () => this.publishAll(),
    });

    this.addCommand({
      id: "publish-and-commit",
      name: "Publish and commit",
      callback: () => this.publishAndCommit(),
    });

    this.addCommand({
      id: "dry-run",
      name: "Dry-run",
      callback: () => this.dryRun(),
    });

    this.addCommand({
      id: "generate-github-action",
      name: "Generate GitHub Action",
      callback: () => this.generateGithubAction(),
    });

    this.addSettingTab(new ConfluenceGitSyncSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async publishCurrentNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }
    await this.publishFile(activeFile);
  }

  private async publishAll() {
    const files = this.app.vault.getFiles().filter((f) => {
      const pattern = this.settings.includePattern;
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(f.name);
    });

    if (files.length === 0) {
      new Notice("No files match the include pattern");
      return;
    }

    new Notice(`Publishing ${files.length} files...`);
    for (const file of files) {
      await this.publishFile(file);
    }
    new Notice(`Published ${files.length} files`);
  }

  private async publishAndCommit() {
    await this.publishAll();
    if (this.settings.autoCommitOnPublish) {
      await this.gitBridge.commitAndPush("Auto-publish via Confluence Git Sync");
      new Notice("Committed and pushed to Git");
    }
  }

  private async dryRun() {
    const files = this.app.vault.getFiles().filter((f) => {
      const pattern = this.settings.includePattern;
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(f.name);
    });

    let summary = `Dry-run: ${files.length} files would be published\n\n`;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const frontmatter = this.frontmatterParser.parse(content);
      const title = frontmatter?.title || file.basename;
      const status = frontmatter?.status || "unknown";
      summary += `  ${file.path} → "${title}" (status: ${status})\n`;
    }

    new Notice(`Dry-run complete — ${files.length} files. See console for details.`);
    console.log(summary);
  }

  private async generateGithubAction() {
    const vaultRoot = (this.app.vault.adapter as any).getBasePath?.() || "";
    const workflowDir = `${vaultRoot}/.github/workflows`;
    const workflowPath = `${workflowDir}/publish.yml`;

    try {
      await this.app.vault.adapter.exists(workflowDir);
    } catch {
      // directory doesn't exist yet, will be created
    }

    const yaml = this.githubActionsGen.generate(
      this.settings.confluenceSpaceKey,
      this.settings.confluenceParentPageId
    );

    // Write via adapter
    const adapter = this.app.vault.adapter;
    await adapter.mkdir(workflowDir);
    await adapter.write(workflowPath, yaml);

    new Notice(`GitHub Action created at ${workflowPath}`);
  }

  private async publishFile(file: TFile) {
    try {
      const content = await this.app.vault.read(file);
      const frontmatter = this.frontmatterParser.parse(content);
      const title = frontmatter?.title || file.basename;
      const tags = frontmatter?.tags || [];

      // Resolve wiki links
      const resolvedContent = await this.wikiLinkResolver.resolve(content, this.app.vault);

      // Convert Markdown to Confluence Storage Format
      const storageFormat = this.converter.convert(resolvedContent);

      // Determine space key from folder mapping
      const spaceKey = this.getSpaceKeyForFile(file.path);

      // Publish
      const pageId = await this.publisher.publish(title, storageFormat, spaceKey, tags);

      new Notice(`Published "${title}" to Confluence (page ID: ${pageId})`);
    } catch (error) {
      new Notice(`Failed to publish "${file.name}": ${error.message}`);
      console.error(error);
    }
  }

  private getSpaceKeyForFile(filePath: string): string {
    for (const [folder, spaceKey] of Object.entries(this.settings.folderSpaceMappings)) {
      if (filePath.startsWith(folder)) {
        return spaceKey;
      }
    }
    return this.settings.confluenceSpaceKey;
  }
}

class ConfluenceGitSyncSettingTab extends PluginSettingTab {
  plugin: ConfluenceGitSyncPlugin;

  constructor(app: App, plugin: ConfluenceGitSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Confluence Git Sync Settings" });

    containerEl.createEl("h3", { text: "Confluence Connection" });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("e.g. https://your-domain.atlassian.net/wiki")
      .addText((text) =>
        text
          .setPlaceholder("https://...")
          .setValue(this.plugin.settings.confluenceBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.confluenceBaseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Email")
      .setDesc("Atlassian account email")
      .addText((text) =>
        text
          .setPlaceholder("user@example.com")
          .setValue(this.plugin.settings.confluenceEmail)
          .onChange(async (value) => {
            this.plugin.settings.confluenceEmail = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Token")
      .setDesc("Generate at https://id.atlassian.com/manage-profile/security/api-tokens")
      .addText((text) => {
        text
          .setPlaceholder("token")
          .setValue(this.plugin.settings.confluenceApiToken)
          .onChange(async (value) => {
            this.plugin.settings.confluenceApiToken = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Space Key")
      .setDesc("e.g. YD, ENG")
      .addText((text) =>
        text
          .setPlaceholder("YD")
          .setValue(this.plugin.settings.confluenceSpaceKey)
          .onChange(async (value) => {
            this.plugin.settings.confluenceSpaceKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Parent Page ID")
      .setDesc("Page ID under which new pages are created")
      .addText((text) =>
        text
          .setPlaceholder("6409158661")
          .setValue(this.plugin.settings.confluenceParentPageId)
          .onChange(async (value) => {
            this.plugin.settings.confluenceParentPageId = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Git Settings" });

    new Setting(containerEl)
      .setName("Repo path")
      .setDesc("Local path to the git repository")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/repo")
          .setValue(this.plugin.settings.gitRepoPath)
          .onChange(async (value) => {
            this.plugin.settings.gitRepoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Branch")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.gitBranch)
          .onChange(async (value) => {
            this.plugin.settings.gitBranch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-commit on publish")
      .setDesc("Automatically commit and push after publishing")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCommitOnPublish)
          .onChange(async (value) => {
            this.plugin.settings.autoCommitOnPublish = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Publishing" });

    new Setting(containerEl)
      .setName("Include pattern")
      .setDesc("Glob pattern for files to publish (e.g. prds/B-*.md)")
      .addText((text) =>
        text
          .setPlaceholder("*.md")
          .setValue(this.plugin.settings.includePattern)
          .onChange(async (value) => {
            this.plugin.settings.includePattern = value;
            await this.plugin.saveSettings();
          })
      );
  }
}