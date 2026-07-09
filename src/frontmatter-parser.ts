/**
 * Parses YAML frontmatter from Obsidian notes and maps it to
 * Confluence page properties and labels.
 *
 * Frontmatter fields mapped:
 *   title       → Confluence page title
 *   tags        → Confluence labels
 *   status      → Confluence page property "status"
 *   aliases     → Confluence page property "aliases"
 *   created     → Confluence page property "created"
 *   updated     → Confluence page property "updated"
 *   decision-deadline → Confluence page property "decision-deadline"
 *   related-confluence → Confluence page property "related-confluence"
 *   related-prds → Confluence page property "related-prds"
 */

import * as yaml from "js-yaml";

export interface FrontmatterData {
  title?: string;
  tags?: string[];
  status?: string;
  aliases?: string[];
  created?: string;
  updated?: string  | string[];
  "confluence-page-id"?: string;
  "confluence-url"?: string;
  [key: string]: unknown;
}

export interface ConfluenceProperties {
  labels: string[];
  properties: Record<string, string>;
  title: string;
}

export class FrontmatterParser {
  /**
   * Parse YAML frontmatter from a markdown string.
   * Returns null if no frontmatter is found.
   */
  parse(markdown: string): FrontmatterData | null {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return null;

    try {
      const data = yaml.load(match[1]) as Record<string, any>;
      return data as FrontmatterData;
    } catch (e) {
      console.warn("Failed to parse frontmatter YAML:", e);
      return null;
    }
  }

  /**
   * Convert parsed frontmatter into Confluence labels and properties.
   */
  toConfluenceProperties(frontmatter: FrontmatterData): ConfluenceProperties {
    const labels: string[] = [];
    const properties: Record<string, string> = {};

    // Tags → Confluence labels
    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
      for (const tag of frontmatter.tags) {
        // Confluence labels: lowercase, no spaces, max 255 chars
        const normalized = tag.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 255);
        if (normalized.length > 0) {
          labels.push(normalized);
        }
      }
    }

    // Status → property
    if (frontmatter.status) {
      properties["status"] = frontmatter.status;
    }

    // Aliases → property (comma-separated)
    if (frontmatter.aliases && Array.isArray(frontmatter.aliases)) {
      properties["aliases"] = frontmatter.aliases.join(", ");
    }

    // Dates
    if (frontmatter.created) {
      properties["created"] = frontmatter.created;
    }
    if (frontmatter.updated) {
      properties["updated"] = Array.isArray(frontmatter.updated)
        ? frontmatter.updated.join(", ")
        : frontmatter.updated;
    }

    // Custom fields
    const decisionDeadline = frontmatter["decision-deadline"];
    if (decisionDeadline) {
      properties["decision-deadline"] = String(decisionDeadline);
    }
    const relatedConfluence = frontmatter["related-confluence"];
    if (relatedConfluence) {
      properties["related-confluence"] = String(relatedConfluence);
    }
    const relatedPrds = frontmatter["related-prds"];
    if (relatedPrds) {
      properties["related-prds"] = String(relatedPrds);
    }

    return {
      labels,
      properties,
      title: frontmatter.title || "Untitled",
    };
  }
}