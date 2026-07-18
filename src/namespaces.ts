/**
 * Implicit parent namespaces from dotted hierarchy.
 * baskcart.sales.policy → [baskcart.sales.policy, baskcart.sales, baskcart]
 */
export function namespaceChain(namespace: string): string[] {
    const parts = namespace.trim().split('.').filter(Boolean);
    if (parts.length === 0) return [];
    const chain: string[] = [];
    for (let i = parts.length; i >= 1; i--) {
        chain.push(parts.slice(0, i).join('.'));
    }
    return chain;
}

/** Parent namespaces only (excludes self). */
export function parentNamespaces(namespace: string): string[] {
    return namespaceChain(namespace).slice(1);
}
