/**
 * Resolves Obsidian wiki-links [[Page Name]] to Confluence page links.
 *
 * Strategy:
 * 1. Find all [[links]] in the markdown content
 * 2. Look up the target file in the vault by basename
 * 3. Read the target file's frontmatter to get its Confluence page ID
 * 4. Replace [[link]] with a Confluence <ac:link> element
 *
 * If the target file has no Confluence page ID yet, the link is left as plain text.
 */

import { Vault, TFile } from "obsidian";

export class WikiLinkResolver {
  private readonly WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  /**
   * Resolve all wiki-links in the given markdown content.
   * Returns the content with wiki-links replaced by Confluence links.
   */
  async resolve(content: string, vault: Vault): Promise<string> {
    let result = content;
    let match: RegExpExecArray | null;

    // Reset regex state
    this.WIKI_LINK_REGEX.lastIndex = 0;

    const replacements: Array<{ original: string; replacement: string }> = [];

    while ((match = this.WIKI_LINK_REGEX.exec(content)) !== null) {
      const [fullMatch, target, alias] = match;
      const displayText = alias || target;

      // Try to find the target file in the vault
      const targetFile = this.findFileByBasename(target, vault);

      if (targetFile) {
        const frontmatter = await this.readFrontmatter(targetFile, vault);
        const confluencePageId = frontmatter?.["confluence-page-id"];

        if (confluencePageId) {
          replacements.push({
            original: fullMatch,
            replacement: `<ac:link><ri:page ri:content-id="${confluencePageId}" /><ac:plain-text-link-body><![CDATA[${displayText}]]></ac:plain-text-link-body></ac:link>`,
          });
        } else {
          // Target exists but has no Confluence page ID yet
          replacements.push({
            original: fullMatch,
            replacement: displayText,
          });
        }
      } else {
        // Target not found in vault — leave as plain text
        replacements.push({
          original: fullMatch,
          replacement: displayText,
        });
      }
    }

    // Apply replacements in reverse order to preserve indices
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { original, replacement } = replacements[i];
      result = result.replace(original, replacement);
    }

    return result;
  }

  /**
   * Find a file in the vault by its basename (without extension).
   */
  private findTargetByBasename(basename: string, vault: Vault): TFile | null {
    const files = vault.getFiles();
    const normalizedTarget = basename.toLowerCase().replace(/\\s+/g, "-");

    for (const file of files) {
      const normalizedFile = file.basename.toLowerCase().replace(/\\s+/g, "-");
      if (normalizedFile === normalizedTarget) {
        return file;
      }
    }

    return null;
  }

  /**
   * Read the YAML frontmatter from a file.
   */
  private async readFrontmatter(
    file: TFile,
    vault: Vault
  ): Promise<Record<string, any> | null> {
    try {
      const content = await vault.read(file);
      const match = content.match(/^---\n([\\s\\S]*?)\n---\n?/);
      if (!match) return null;

      // Simple YAML parse (avoiding full parser dependency for speed)
      const lines = match[1].split("\n");
      const result: Record<string, any> = {};

      for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          let value: any = line.slice(colonIndex + 1).trim();

          // Handle arrays: [item1, item2]
          if (value.startsWith("[") && value.endsWith("]")) {
            value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/['"]/g, ""));
          }
          // Handle quoted strings
          else if ((value.startsWith('"') && value.endsWith('"')) || 
                   (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          result[key] = value;
        }
      }

      return result;
    } catch {
      return null;
    }
  }
}