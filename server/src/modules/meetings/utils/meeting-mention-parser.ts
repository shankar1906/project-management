/**
 * Meeting Mention Parser
 * Walks TipTap JSON tree and extracts all mention nodes.
 * 
 * CRITICAL: Backend always re-extracts mentions from content JSON.
 * Frontend-supplied mentions are IGNORED for security.
 */

export interface ExtractedMention {
    type: 'USER' | 'PROJECT';
    userId?: string;
    projectId?: string;
    positionPath: (string | number)[];
}

/**
 * Extracts all mentions from a TipTap JSON document.
 * 
 * Expected TipTap mention node structure:
 * {
 *   "type": "mention",
 *   "attrs": {
 *     "entityType": "USER" | "PROJECT",
 *     "id": "<userId or projectId>",
 *     "label": "<display name>"
 *   }
 * }
 */
export function extractMentions(content: any): ExtractedMention[] {
    const mentions: ExtractedMention[] = [];

    function walk(node: any, path: (string | number)[]) {
        if (!node || typeof node !== 'object') return;

        // Check if this node is a mention
        // Check if this node is a mention
        if (node.type === 'mention' && node.attrs) {
            const { entityType, id } = node.attrs;

            // Explicit USER type or missing type (default to USER)
            if (id && (!entityType || entityType === 'USER')) {
                mentions.push({
                    type: 'USER',
                    userId: id,
                    positionPath: [...path],
                });
            }
            // Fallback: If they used 'mention' type but set entityType to PROJECT
            else if (id && entityType === 'PROJECT') {
                mentions.push({
                    type: 'PROJECT',
                    projectId: id,
                    positionPath: [...path],
                });
            }
        }
        // Check for custom 'projectMention' node type
        else if (node.type === 'projectMention' && node.attrs) {
            const { id } = node.attrs;
            if (id) {
                mentions.push({
                    type: 'PROJECT',
                    projectId: id,
                    positionPath: [...path],
                });
            }
        }

        // Recurse into content array (TipTap stores children in "content")
        if (Array.isArray(node.content)) {
            node.content.forEach((child: any, index: number) => {
                walk(child, [...path, 'content', index]);
            });
        }

        // Some nodes may have marks or other nested structures
        if (Array.isArray(node.marks)) {
            node.marks.forEach((mark: any, index: number) => {
                walk(mark, [...path, 'marks', index]);
            });
        }
    }

    walk(content, []);
    return mentions;
}

/**
 * Deduplicates mentions by type + id.
 * Keeps the first occurrence (earliest positionPath) for each unique mention.
 */
export function deduplicateMentions(mentions: ExtractedMention[]): ExtractedMention[] {
    const seen = new Set<string>();
    const result: ExtractedMention[] = [];

    for (const mention of mentions) {
        const key = mention.type === 'USER'
            ? `USER:${mention.userId}`
            : `PROJECT:${mention.projectId}`;

        if (!seen.has(key)) {
            seen.add(key);
            result.push(mention);
        }
    }

    return result;
}
