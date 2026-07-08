/**
 * Idempotent Confluence publisher.
 *
 * Strategy:
 * 1. Search for an existing page by title in the target space
 * 2. If found → update it (PUT /rest/api/content/{id})
 * 3. If not found → create it under the parent page (POST /rest/api/content)
 * 4. Apply labels after create/update
 * 5. Set page properties after create/update
 */

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
      pageId = await this.createPage(title, storageFormat, targetSpace);
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
   */
  private async findPageByTitle(
    title: string,
    spaceKey: string
  ): Promise<{ id: string; version: number } | null> {
    const cql = encodeURIComponent(`title="${title}" AND space="${spaceKey}"`);
    const url = `${this.baseUrl}/rest/api/content?cql=${cql}&limit=1`;

    const response = await this.fetchWithAuth(url);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      return {
        id: data.results[0].id,
        version: data.results[0].version.number,
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

    const response = await this.fetchWithAuth(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return data.id;
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

    await this.fetchWithAuth(url, {
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
        await this.fetchWithAuth(url, {
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
        await this.fetchWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: { value } }),
        });
      } catch (e) {
        // Property might already exist — try updating instead
        try {
          const updateUrl = `${this.baseUrl}/rest/api/content/${pageId}/property/${key}`;
          await this.fetchWithAuth(updateUrl, {
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

  private async fetchWithAuth(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const auth = btoa(`${this.email}:${this.apiToken}`);
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Confluence API error (${response.status}): ${errorText}`
      );
    }

    return response;
  }
}