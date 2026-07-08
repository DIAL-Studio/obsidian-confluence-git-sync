/**
 * Converts Obsidian Markdown to Confluence Storage Format (XHTML).
 *
 * Handles:
 * - Headings (h1-h6)
 * - Bold, italic, strikethrough, inline code
 * - Unordered and ordered lists
 * - Code blocks (fenced)
 * - Tables
 * - Links (external and wiki-links resolved upstream)
 * - Images
 * - Blockquotes
 * - Horizontal rules
 * - YAML frontmatter (stripped)
 * - HTML anchors (<a id="">) preserved
 * - Admonitions / callouts → Confluence info/tip/warning panels
 */

export class MdToConfluenceConverter {
  convert(markdown: string): string {
    let content = markdown;

    // Strip YAML frontmatter
    content = content.replace(/^---\n[\s\S]*?\n---\n?/, "");

    // Convert callouts (Obsidian > [!note] style)
    content = this.convertCallouts(content);

    // Convert code blocks
    content = this.convertCodeBlocks(content);

    // Convert images
    content = this.convertImages(content);

    // Convert links
    content = this.convertLinks(content);

    // Convert horizontal rules
    content = content.replace(/^---\s*$/gm, "<hr />");

    // Convert blockquotes
    content = this.convertBlockquotes(content);

    // Convert tables
    content = this.convertTables(content);

    // Convert headings
    content = this.convertHeadings(content);

    // Convert lists
    content = this.convertLists(content);

    // Convert inline formatting
    content = this.convertInlineFormatting(content);

    // Wrap in Confluence Storage Format envelope
    return `<ac:structured-macro ac:name="markdown">
  <ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body>
</ac:structured-macro>`;
  }

  private convertHeadings(md: string): string {
    return md.replace(/^(#{1,6})\s+(.+)$/gm, (_match, hashes, text) => {
      const level = hashes.length;
      return `<h${level}>${text.trim()}</h${level}>`;
    });
  }

  private convertInlineFormatting(md: string): string {
    let result = md;

    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Italic
    result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
    result = result.replace(/_(.+?)_/g, "<em>$1</em>");

    // Strikethrough
    result = result.replace(/~~(.+?)~~/g, "<span style='text-decoration: line-through;'>$1</span>");

    // Inline code
    result = result.replace(/`(.+?)`/g, "<code>$1</code>");

    return result;
  }

  private convertLists(md: string): string {
    let content = md;

    // Unordered lists
    content = content.replace(/^(\s*)[-*+]\s+(.+)$/gm, (_match, indent, text) => {
      const depth = Math.floor(indent.length / 2);
      const indentStr = "  ".repeat(depth);
      return `${indentStr}<li>${text}</li>`;
    });

    // Ordered lists
    content = content.replace(/^(\s*)\d+\.\s+(.+)$/gm, (_match, indent, text) => {
      const depth = Math.floor(indent.length / 2);
      const indentStr = "  ".repeat(depth);
      return `${indentStr}<li>${text}</li>`;
    });

    // Wrap consecutive <li> in <ul> or <ol>
    // This is a simplified approach — a proper parser would be more robust
    content = content.replace(/((?:^  <li>.*$\n?)+)/gm, "<ul>\n$1</ul>\n");

    return content;
  }

  private convertCodeBlocks(md: string): string {
    return md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const language = lang || "none";
      return `<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">${language}</ac:parameter>
  <ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body>
</ac:structured-macro>`;
    });
  }

  private convertTables(md: string): string {
    const tableRegex = /^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm;

    return md.replace(tableRegex, (_match: string, headerRow: string, bodyRows: string) => {
      const headers = headerRow
        .split("|")
        .map((h: string) => h.trim())
        .filter((h: string) => h.length > 0);

      const rows = bodyRows
        .trim()
        .split("\n")
        .map((row: string) =>
          row
          .split("|")
          .map((c: string) => c.trim())
          .filter((c: string) => c.length > 0)
        );

      let table = "<table>\n<thead>\n<tr>\n";
      for (const header of headers) {
        table += `<th>${header}</th>\n`;
      }
      table += "</tr>\n</thead>\n<tbody>\n";

      for (const row of rows) {
        table += "<tr>\n";
        for (const cell of row) {
          table += `<td>${cell}</td>\n`;
        }
        table += "</tr>\n";
      }

      table += "</tbody>\n</table>";
      return table;
    });
  }

  private convertBlockquotes(md: string): string {
    return md.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
  }

  private convertLinks(md: string): string {
    // Markdown links [text](url)
    return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  private convertImages(md: string): string {
    // Markdown images ![alt](url)
    return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<ac:image><ri:url ri:value="$2" /></ac:image>');
  }

  private convertCallouts(md: string): string {
    // Obsidian callouts: > [!type] Title
    // Supported types: note, info, tip, warning, danger, abstract, question
    const calloutMap: Record<string, string> = {
      note: "info",
      info: "info",
      tip: "tip",
      warning: "warning",
      danger: "warning",
      abstract: "info",
      question: "info",
    };

    const calloutRegex = /^>\s*\[!(\w+)\]\s*(.*)$\n((?:^>.*$\n?)*)/gm;

    return md.replace(calloutRegex, (_match, type, title, body) => {
      const confluenceType = calloutMap[type.toLowerCase()] || "info";
      const cleanBody = body.replace(/^>\s*/gm, "").trim();
      const panelTitle = title || type.charAt(0).toUpperCase() + type.slice(1);

      return `<ac:structured-macro ac:name="${confluenceType}">
  <ac:parameter ac:name="title">${panelTitle}</ac:parameter>
  <ac:rich-text-body>
    <p>${cleanBody}</p>
  </ac:rich-text-body>
</ac:structured-macro>`;
    });
  }
}