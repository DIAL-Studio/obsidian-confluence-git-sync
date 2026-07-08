import { FrontmatterParser } from "../src/frontmatter-parser";

describe("FrontmatterParser", () => {
  let parser: FrontmatterParser;

  beforeEach(() => {
    parser = new FrontmatterParser();
  });

  describe("parse", () => {
    it("parses valid YAML frontmatter", () => {
      const input = "---\ntitle: Test Page\ntags: [a, b, c]\nstatus: draft\n---\n\nContent";
      const result = parser.parse(input);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Test Page");
      expect(result!.tags).toEqual(["a", "b", "c"]);
      expect(result!.status).toBe("draft");
    });

    it("returns null if no frontmatter", () => {
      const input = "Just content without frontmatter";
      const result = parser.parse(input);
      expect(result).toBeNull();
    });

    it("handles empty frontmatter", () => {
      const input = "---\n---\n\nContent";
      const result = parser.parse(input);
      expect(result).not.toBeNull();
    });
  });

  describe("toConfluenceProperties", () => {
    it("converts tags to labels", () => {
      const result = parser.toConfluenceProperties({
        title: "Test",
        tags: ["PRD", "B-1", "RAG"],
      });
      expect(result.labels).toContain("prd");
      expect(result.labels).toContain("b-1");
      expect(result.labels).toContain("rag");
    });

    it("converts status to property", () => {
      const result = parser.toConfluenceProperties({
        title: "Test",
        status: "draft",
      });
      expect(result.properties["status"]).toBe("draft");
    });

    it("handles aliases", () => {
      const result = parser.toConfluenceProperties({
        title: "Test",
        aliases: ["Foo", "Bar"],
      });
      expect(result.properties["aliases"]).toBe("Foo, Bar");
    });

    it("handles custom fields", () => {
      const result = parser.toConfluenceProperties({
        title: "Test",
        "decision-deadline": "2026-08-01",
        "related-prds": "B-1, B-3",
      });
      expect(result.properties["decision-deadline"]).toBe("2026-08-01");
      expect(result.properties["related-prds"]).toBe("B-1, B-3");
    });

    it("defaults title to Untitled", () => {
      const result = parser.toConfluenceProperties({});
      expect(result.title).toBe("Untitled");
    });
  });
});
