/**
 * Heuristic document → candidate facts (no LLM).
 * Always intended for proposed channel — never auto-publish.
 */
import { suggestFactKey } from './suggest-key.js';

export interface ExtractedCandidate {
    namespace: string;
    key: string;
    value: string;
    confidence: 'high' | 'medium' | 'low';
    source_line?: number;
}

const ASSERTION =
    /\b(is|are|must|shall|should|will|may|can|cannot|can't|won't|require|requires|required|include|includes|within|before|after|days?|hours?|weeks?|months?|years?|percent|%)\b/i;

function normalizeLine(line: string): string {
    return line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^>\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function looksLikeFact(text: string): boolean {
    if (text.length < 12 || text.length > 400) return false;
    if (/^https?:\/\//i.test(text)) return false;
    if (/[{}<>]|```/.test(text)) return false;
    if (!/[a-zA-Z]/.test(text)) return false;
    // Prefer statement-like lines
    if (ASSERTION.test(text)) return true;
    if (/[.!?]$/.test(text) && text.split(/\s+/).length >= 5) return true;
    return text.split(/\s+/).length >= 6 && /[A-Za-z].*[A-Za-z]/.test(text);
}

function confidenceFor(text: string): 'high' | 'medium' | 'low' {
    if (ASSERTION.test(text) && /[.!?]$/.test(text)) return 'high';
    if (ASSERTION.test(text)) return 'medium';
    return 'low';
}

/**
 * Split plain text / markdown into candidate fact values.
 */
export function extractFactCandidates(
    documentText: string,
    options?: { namespace?: string; max?: number }
): ExtractedCandidate[] {
    const namespace = options?.namespace?.trim() || 'policy';
    const max = Math.min(Math.max(options?.max ?? 40, 1), 200);
    const lines = documentText.split(/\r?\n/);
    const out: ExtractedCandidate[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const value = normalizeLine(lines[i]);
        if (!looksLikeFact(value)) continue;

        const { key } = suggestFactKey(value, namespace);
        const dedupe = `${namespace}/${key}:${value.toLowerCase()}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);

        out.push({
            namespace,
            key,
            value,
            confidence: confidenceFor(value),
            source_line: i + 1
        });
        if (out.length >= max) break;
    }

    // Also split long paragraphs into sentences when few bullets found
    if (out.length < 3) {
        const para = documentText.replace(/\s+/g, ' ').trim();
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const raw of sentences) {
            const value = normalizeLine(raw);
            if (!looksLikeFact(value)) continue;
            const { key } = suggestFactKey(value, namespace);
            const dedupe = `${namespace}/${key}:${value.toLowerCase()}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            out.push({
                namespace,
                key,
                value,
                confidence: confidenceFor(value)
            });
            if (out.length >= max) break;
        }
    }

    return out;
}
