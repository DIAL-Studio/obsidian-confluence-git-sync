import { IdempotentPublisher } from "../src/idempotent-publisher";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("IdempotentPublisher", () => {
  let publisher: IdempotentPublisher;

  beforeEach(() => {
    mockFetch.mockReset();
    publisher = new IdempotentPublisher(
      "https://example.atlassian.net/wiki",
      "user@example.com",
      "fake-token",
      "SPACE",
      "12345"
    );
  });

  describe("publish", () => {
    it("creates a new page if not found", async () => {
      // First call: search returns empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      // Second call: create page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "new-page-id" }),
      });

      const pageId = await publisher.publish("New Page", "<p>content</p>");

      expect(pageId).toBe("new-page-id");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify create call
      const createCall = mockFetch.mock.calls[1];
      expect(createCall[0]).toContain("/rest/api/content");
      expect(createCall[1].method).toBe("POST");
    });

    it("updates an existing page if found", async () => {
      // First call: search returns existing page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ id: "existing-id", version: { number: 3 } }],
        }),
      });
      // Second call: update page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const pageId = await publisher.publish("Existing Page", "<p>updated</p>");

      expect(pageId).toBe("existing-id");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify update call
      const updateCall = mockFetch.mock.calls[1];
      expect(updateCall[0]).toContain("/rest/api/content/existing-id");
      expect(updateCall[1].method).toBe("PUT");
      const body = JSON.parse(updateCall[1].body);
      expect(body.version.number).toBe(4); // 3 + 1
    });

    it("applies labels when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "page-id" }),
      });
      // Label calls
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      await publisher.publish("Page", "<p>content</p>", undefined, [
        "tag1",
        "tag2",
      ]);

      // 1 search + 1 create + 2 labels = 4 calls
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it("handles Confluence API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        publisher.publish("Fail Page", "<p>content</p>")
      ).rejects.toThrow("Confluence API error (500)");
    });
  });
});
