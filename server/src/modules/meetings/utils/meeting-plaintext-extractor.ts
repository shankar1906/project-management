/**
 * Meeting Plain Text Extractor
 * Walks TipTap JSON tree and extracts all text content.
 * Used for full-text search on Meeting.plainText field.
 */

/**
 * Recursively extracts plain text from a TipTap JSON document.
 * Joins text nodes with spaces, paragraphs with newlines.
 */
export function extractPlainText(content: any): string {
    if (!content || typeof content !== 'object') return '';

    const parts: string[] = [];

    function walk(node: any) {
        if (!node || typeof node !== 'object') return;

        // Text node — collect the text
        if (node.type === 'text' && typeof node.text === 'string') {
            parts.push(node.text);
            return;
        }

        // Mention node — collect the label
        if (node.type === 'mention' && node.attrs?.label) {
            parts.push(node.attrs.label);
            return;
        }

        // Hard break
        if (node.type === 'hardBreak') {
            parts.push('\n');
            return;
        }

        // Recurse into children
        if (Array.isArray(node.content)) {
            for (const child of node.content) {
                walk(child);
            }

            // Add newline after block-level nodes
            const blockTypes = ['paragraph', 'heading', 'blockquote', 'listItem', 'bulletList', 'orderedList'];
            if (blockTypes.includes(node.type)) {
                parts.push('\n');
            }
        }
    }

    walk(content);

    // Trim and collapse multiple whitespace
    return parts
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
