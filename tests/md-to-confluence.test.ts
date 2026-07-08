import { MdToConfluenceConverter } from "../src/md-to-confluence";

describe("MdToConfluenceConverter", () => {
  let converter: MdToConfluenceConverter;

  beforeEach(() => {
    converter = new MdToConfluenceConverter();
  });

  describe("headings", () => {
    it("converts h1 to h6", () => {
      const input = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
      const output = converter.convert(input);
      expect(output).toContain("<h1>H1</h1>");
      expect(output).toContain("<h2>H2</h2>");
      expect(output).toContain("<h3>H3</h3>");
      expect(output).toContain("<h4>H4</h4>");
      expect(output).toContain("<h5>H5</h5>");
      expect(output).toContain("<h6>H6</h6>");
    });
  });

  describe("inline formatting", () => {
    it("converts bold", () => {
      const output = converter.convert("**bold** __bold__");
      expect(output).toContain("<strong>bold</strong>");
    });

    it("converts italic", () => {
      const output = converter.convert("*italic* _italic_");
      expect(output).toContain("<em>italic</em>");
    });

    it("converts strikethrough", () => {
      const output = converter.convert("~~strikethrough~~");
      expect(output).toContain("line-through");
    });

    it("converts inline code", () => {
      const output = converter.convert("text \`code\` text");
      expect(output).toContain("<code>code</code>");
    });
  });

  describe("code blocks", () => {
    it("converts fenced code blocks", () => {
      const input = "\`\`\`python\nprint('hello')\n\`\`\`";
      const output = converter.convert(input);
      expect(output).toContain("ac:name=\"code\"");
      expect(output).toContain("language\">python</ac:parameter>");
      expect(output).toContain("print('hello')");
    });

    it("handles code blocks without language", () => {
      const input = "\`\`\`\nplain code\n\`\`\`";
      const output = converter.convert(input);
      expect(output).toContain("language\">none</ac:parameter>");
    });
  });

  describe("tables", () => {
    it("converts markdown tables", () => {
      const input = "| A | B |\n|---|---|\n| 1 | 2 |";
      const output = converter.convert(input);
      expect(output).toContain("<table>");
      expect(output).toContain("<th>A</th>");
      expect(output).toContain("<td>1</td>");
    });
  });

  describe("links", () => {
    it("converts markdown links", () => {
      const input = "[text](https://example.com)";
      const output = converter.convert(input);
      expect(output).toContain('<a href="https://example.com">text</a>');
    });
  });

  describe("images", () => {
    it("converts markdown images", () => {
      const input = "![alt](image.png)";
      const output = converter.convert(input);
      expect(output).toContain("ac:image");
      expect(output).toContain("ri:url ri:value=\"image.png\"");
    });
  });

  describe("YAML frontmatter", () => {
    it("strips frontmatter from output", () => {
      const input = "---\ntitle: Test\ntags: [a, b]\n---\n\n# Hello";
      const output = converter.convert(input);
      expect(output).not.toContain("title: Test");
      expect(output).not.toContain("tags:");
      expect(output).toContain("<h1>Hello</h1>");
    });
  });

  describe("blockquotes", () => {
    it("converts blockquotes", () => {
      const input = "> This is a quote";
      const output = converter.convert(input);
      expect(output).toContain("<blockquote>This is a quote</blockquote>");
    });
  });

  describe("horizontal rules", () => {
    it("converts horizontal rules", () => {
      const input = "---";
      const output = converter.convert(input);
      expect(output).toContain("<hr />");
    });
  });
});
