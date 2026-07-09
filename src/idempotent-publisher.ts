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
    properties?: Record<string, string>
  ): Promise<string> {
    const targetSpace = spaceKey || this.spaceKey;

    // Search for existing page by title
    const existingPage = await this.findPageByTitle(title, targetSpace);

    let pageId: string;

    if (existingPage) {
      // Update existing page
      pageId = existingPage.id;
      await this.updatePage(pageId, title, storageFormat, existingPage.version);
    } else {
      // Create new page
      try {
        pageId = await this.createPage(title, storageFormat, targetSpace);
      } catch (createError: any) {
        // If creation fails because a page with this title already exists
        // (it could be a draft or have a status we filtered out), find it
        // without any status filter and update it instead.
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
    const cql = encodeURIComponent(`title="${title}" AND space="${spaceKey}"`);
    const url = `${this.baseUrl}/rest/api/content?cql=${cql}&limit=5&expand=version`;

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
          // Validate title matches — CQL on our instance sometimes returns
          // pages with wrong titles (e.g. archived pages from other spaces)
          p.title === title
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
   * Fallback search that returns a page regardless of status.
   * Used when createPage fails with "already exists" — the page might be
   * in an unexpected status (e.g. draft) that findPageByTitle filtered out.
   */
  private async findPageByTitleFallback(
    title: string,
    spaceKey: string
  ): Promise<{ id: string; version: number } | null> {
    const cql = encodeURIComponent(`title="${title}" AND space="${spaceKey}"`);
    const url = `${this.baseUrl}/rest/api/content?cql=${cql}&limit=5&expand=version&status=any`;

    try {
      const response = await this.requestWithAuth(url);
      const data = response.json;

      if (data.results && data.results.length > 0) {
        // Skip archived/trashed — same filter as findPageByTitle
        const page = data.results.find(
          (p: any) =>
            p.id &&
            p.status !== "archived" &&
            p.status !== "trashed" &&
            p.title === title
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
