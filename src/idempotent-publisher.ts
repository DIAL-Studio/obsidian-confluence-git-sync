/**
 * Idempotent Confluence publisher.
 *
 * Strategy:
 * 1. Search for an existing page by title in the target space
 * 2. If found → update it (PUT /rest/api/content/{id})
 * 3. If not found → create it under the parent page (POST /rest/api/content)
 * 4. Apply labels after create/update
 * 5. Set page properties after create/update
 *
 * Uses Obsidian's requestUrl() instead of fetch() to avoid CORS restrictions
 * (Obsidian runs on app:// protocol; browser fetch is blocked by Confluence).
 */

import { requestUrl } from "obsidian";

export class IdempotentPublisher {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private spaceKey: string;
  private parentPageId: string;

  constructor(
    baseUrl: string,
    email: string,
    apiToken: string,
    spaceKey: string,
    parentPageId: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.email = email;
    this.apiToken = apiToken;
    this.spaceKey = spaceKey;
    this.parentPageId = parentPageId;
  }

  /**
   * Publish a page to Confluence. Creates or updates idempotently.
   * Returns the Confluence page ID.
   */
  async publish(
    title: string,
    storageFormat: string,
    spaceKey?: string,
    tags?: string[],
    properties?: Record<string, string>,
    existingPageId?: string
  ): Promise<string> {
    const targetSpace = spaceKey || this.spaceKey;

    let pageId = "";
    let version: number | undefined;

    if (existingPageId) {
      // Direct update using the known page ID (from frontmatter).
      // Faster and avoids CQL search issues entirely.
      version = await this.getPageVersion(existingPageId);
      if (version !== undefined) {
        pageId = existingPageId;
      }
      // If version is undefined (page not found), fall through to search/create
    }

    if (!pageId) {
      // Search for existing page by title
      const existingPage = await this.findPageByTitle(title, targetSpace);
      if (existingPage) {
        pageId = existingPage.id;
        version = existingPage.version;
      }
    }

    if (pageId && version !== undefined) {
      await this.updatePage(pageId, title, storageFormat, version);
    } else if (!pageId) {
      // Create new page
      try {
        pageId = await this.createPage(title, storageFormat, targetSpace);
      } catch (createError: any) {
        if (
          createError.message?.includes("already exists") ||
          createError.message?.includes("A page with this title already exists")
        ) {
          const fallbackPage = await this.findPageByTitleFallback(title, targetSpace);
          if (fallbackPage) {
            pageId = fallbackPage.id;
            await this.updatePage(pageId, title, storageFormat, fallbackPage.version);
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    // Apply labels
    if (tags && tags.length > 0) {
      await this.applyLabels(pageId, tags);
    }

    // Apply properties
    if (properties) {
      await this.applyProperties(pageId, properties);
    }

    return pageId;
  }

  /**
   * Check if a page is under the given parent page ID by inspecting
   * its ancestors array. Returns true if the page is a direct child
   * or descendant of the parent.
   */
  private pageIsUnderParent(page: any, parentPageId: string): boolean {
    const ancestors = page.ancestors;
    if (!ancestors || !Array.isArray(ancestors)) {
      // No ancestors means the page is at the root. Accept it if
      // the parent is also the root, but this is unlikely for our use case.
      return false;
    }
    return ancestors.some((a: any) => a.id === parentPageId);
  }

  /**
   * Get the current version number of a page by its ID.
   * Returns undefined if the page doesn't exist or is inaccessible.
   */
  private async getPageVersion(pageId: string): Promise<number | undefined> {
    try {
      const url = `${this.baseUrl}/rest/api/content/${pageId}?expand=version`;
      const response = await this.requestWithAuth(url);
      return response.json.version?.number;
    } catch (e) {
      console.warn(`Failed to get version for page ${pageId}:`, e);
      return undefined;
    }
  }

  /**
   * Search for a page by exact title in the given space.
   *
   * NOTE: CQL filter `status=current` is unreliable in Confluence Cloud — it
   * sometimes returns archived pages. We explicitly filter out non-current
   * pages from the results instead.
   */
  private async findPageByTitle(
    title: string,
    spaceKey: string
  ): Promise<{ id: string; version: number } | null> {
    const url = `${this.baseUrl}/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&limit=10&expand=version,ancestors`;

    const response = await this.requestWithAuth(url);
    const data = response.json;

    if (data.results && data.results.length > 0) {
      // Only exclude archived and trashed pages — draft pages are updatable
      // and should not trigger duplicate-tile errors on create
      const currentPages = data.results.filter(
        (p: any) =>
          p.id &&
          p.status !== "archived" &&
          p.status !== "trashed" &&
          this.pageIsUnderParent(p, this.parentPageId)
      );

      if (currentPages.length === 0) {
        return null;
      }

      const page = currentPages[0];
      return {
        id: page.id,
        version: page.version?.number || 0,
      };
    }

    return null;
  }

  /**
   * Create a new page under the parent page.
   */
  private async createPage(
    title: string,
    storageFormat: string,
    spaceKey: string
  ): Promise<string> {
    const url = `${this.baseUrl}/rest/api/content`;

    const body = {
      type: "page",
      title: title,
      space: { key: spaceKey },
      ancestors: [{ id: this.parentPageId }],
      body: {
        storage: {
          value: storageFormat,
          representation: "storage",
        },
      },
    };

    const response = await this.requestWithAuth(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return response.json.id;
  }

  /**
   * Update an existing page.
   */
  private async updatePage(
    pageId: string,
    title: string,
    storageFormat: string,
    currentVersion: number
  ): Promise<void> {
    const url = `${this.baseUrl}/rest/api/content/${pageId}`;

    const body = {
      id: pageId,
      type: "page",
      title: title,
      version: { number: currentVersion + 1 },
      body: {
        storage: {
          value: storageFormat,
          representation: "storage",
        },
      },
    };

    await this.requestWithAuth(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Apply Confluence labels to a page.
   */
  private async applyLabels(pageId: string, tags: string[]): Promise<void> {
    const url = `${this.baseUrl}/rest/api/content/${pageId}/label`;

    for (const tag of tags) {
      try {
        await this.requestWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: "global", name: tag }),
        });
      } catch (e) {
        // Label might already exist — ignore 409 Conflict
        console.warn(`Failed to apply label "${tag}":`, e);
      }
    }
  }

  /**
   * Apply Confluence page properties (content properties).
   */
  private async applyProperties(
    pageId: string,
    properties: Record<string, string>
  ): Promise<void> {
    for (const [key, value] of Object.entries(properties)) {
      const url = `${this.baseUrl}/rest/api/content/${pageId}/property`;

      try {
        await this.requestWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: { value } }),
        });
      } catch (e) {
        // Property might already exist — try updating instead
        try {
          const updateUrl = `${this.baseUrl}/rest/api/content/${pageId}/property/${key}`;
          await this.requestWithAuth(updateUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, value: { value } }),
          });
        } catch (e2) {
          console.warn(`Failed to set property "${key}":`, e2);
        }
      }
    }
  }

  /**
   * Fallback search that bypasses the broken CQL space filter.
   * Searches by title only and validates space + status in JavaScript.
   * Used when createPage fails with "already exists".
   */
  private async findPageByTitleFallback(
    title: string,
    spaceKey: string
  ): Promise<{ id: string; version: number } | null> {
    const url = `${this.baseUrl}/rest/api/content?title=${encodeURIComponent(title)}&limit=10&expand=version,space,ancestors&status=any`;

    try {
      const response = await this.requestWithAuth(url);
      const data = response.json;

      if (data.results && data.results.length > 0) {
        const page = data.results.find(
          (p: any) =>
            p.id &&
            p.status !== "archived" &&
            p.status !== "trashed" &&
            p.space?.key === spaceKey &&
            this.pageIsUnderParent(p, this.parentPageId)
        );
        if (page) {
          return {
            id: page.id,
            version: page.version?.number || 0,
          };
        }
      }
    } catch (e) {
      console.warn("Fallback search also failed", e);
    }

    return null;
  }

  /**
   * Make an authenticated request to Confluence using Obsidian's requestUrl().
   * This avoids CORS restrictions that affect fetch() from app:// protocol.
   */
  private async requestWithAuth(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ): Promise<{ status: number; json: any; text: string }> {
    const auth = btoa(`${this.email}:${this.apiToken}`);

    const response = await requestUrl({
      url: url,
      method: options.method || "GET",
      headers: {
        ...options.headers,
        Authorization: `Basic ${auth}`,
      },
      body: options.body,
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(
        `Confluence API error (${response.status}): ${response.text}`
      );
    }

    return response;
  }
}
