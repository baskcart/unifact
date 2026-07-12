/**
 * Local heuristic fact-key suggestion (no LLM).
 * Prefer short concept names; callers may override with --key.
 */

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
    'don', 'dont', 'doesnt', 'didnt', 'wont', 'cant', 'isnt', 'arent', 'wasnt',
    'werent', 'havent', 'hasnt', 'hadnt', 'wouldnt', 'couldnt', 'shouldnt',
    'not', 'no', 'yes', 'really', 'very', 'too', 'also', 'just', 'even', 'still',
    'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'as', 'by', 'about',
    'that', 'this', 'these', 'those', 'there', 'here', 'what', 'which', 'who',
    'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had', 'all', 'time',
    'more', 'most', 'many', 'much', 'some', 'any', 'other', 'others', 'than'
]);

const WEAK_WORDS = new Set([
    'feel', 'feels', 'felt', 'feeling', 'get', 'gets', 'got', 'make', 'makes',
    'seem', 'seems', 'seemed', 'want', 'wants', 'need', 'needs', 'like', 'likes',
    'know', 'knows', 'think', 'thinks', 'say', 'says', 'said', 'use', 'uses',
    'come', 'comes', 'go', 'goes', 'going', 'take', 'takes', 'give', 'gives'
]);

const CONTRACTIONS: Array<[RegExp, string]> = [
    [/\b(won't)\b/gi, 'will not'],
    [/\b(can't)\b/gi, 'can not'],
    [/\b(n't)\b/gi, ' not'],
    [/\b(i'm)\b/gi, 'i am'],
    [/\b(it's)\b/gi, 'it is'],
    [/\b(that's)\b/gi, 'that is']
];

export function sanitizeFactKey(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .replace(/_+/g, '_')
        .slice(0, 48);
}

function expandContractions(text: string): string {
    let out = text;
    for (const [re, rep] of CONTRACTIONS) {
        out = out.replace(re, rep);
    }
    return out;
}

function contentTokens(value: string): string[] {
    const normalized = expandContractions(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ');
    const raw = normalized
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    const unique: string[] = [];
    for (const t of raw) {
        if (!unique.includes(t)) unique.push(t);
    }
    return unique;
}

/** Prefer sleepy over sleeping when both appear. */
function preferConceptForms(tokens: string[]): string[] {
    const set = new Set(tokens);
    return tokens.filter((token) => {
        if (!token.endsWith('ing') || token.length < 6) return true;
        const stem = token.slice(0, -3);
        for (const other of set) {
            if (other === token) continue;
            if (other === stem || other.startsWith(stem)) return false;
        }
        return true;
    });
}

function scoreToken(token: string): number {
    let score = Math.min(token.length, 10);
    if (WEAK_WORDS.has(token)) score -= 6;
    if (token.endsWith('ing') && token.length > 5) score -= 2;
    if (token.endsWith('y') && token.length >= 5) score += 3;
    return score;
}

function conceptStem(token: string): string {
    if (token.endsWith('y') && token.length >= 5) return token;
    if (token.endsWith('ing') && token.length > 5) {
        const stem = token.slice(0, -3);
        if (stem.length >= 3) return stem;
    }
    return token;
}

export interface SuggestKeyResult {
    key: string;
    namespace: string;
}

export function suggestFactKey(value: string, namespace = 'policy'): SuggestKeyResult {
    const tokens = preferConceptForms(contentTokens(value));
    const orderedStrong = tokens.filter((t) => !WEAK_WORDS.has(t));
    const strong = [...orderedStrong].sort((a, b) => scoreToken(b) - scoreToken(a));
    const weak = tokens.filter((t) => WEAK_WORDS.has(t));

    let key = '';

    if (weak.includes('feel') || weak.includes('feeling') || weak.includes('feels')) {
        const feelPos =
            tokens.indexOf('feel') >= 0
                ? tokens.indexOf('feel')
                : tokens.indexOf('feeling') >= 0
                  ? tokens.indexOf('feeling')
                  : tokens.indexOf('feels');
        const afterFeel =
            orderedStrong.find((t) => tokens.indexOf(t) > feelPos) || orderedStrong[0];
        if (afterFeel) key = sanitizeFactKey(`feeling_${conceptStem(afterFeel)}`);
    }

    if (!key && strong.length >= 2) {
        key = sanitizeFactKey(`${strong[0]}_${strong[1]}`);
    } else if (!key && strong.length === 1) {
        key = sanitizeFactKey(strong[0]);
    } else if (!key && weak.length && strong.length) {
        key = sanitizeFactKey(`${weak[0]}_${strong[0]}`);
    } else if (!key && tokens.length) {
        key = sanitizeFactKey(tokens.slice(0, 2).join('_'));
    }

    if (!key) key = 'fact';

    const parts = key.split('_').filter(Boolean);
    if (parts.length > 2) key = parts.slice(0, 2).join('_');

    return { key, namespace };
}
