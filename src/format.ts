import { stringify } from 'yaml';

export type FormatType = 'json' | 'text' | 'yaml' | 'env';

export interface FactData {
    namespace: string;
    key: string;
    value: string;
    description: string | null;
}

export function formatFacts(facts: FactData[], format: FormatType): string {
    switch (format) {
        case 'json':
            return formatJson(facts);
        case 'yaml':
            return formatYaml(facts);
        case 'env':
            return formatEnv(facts);
        case 'text':
        default:
            return formatText(facts);
    }
}

function formatJson(facts: FactData[]): string {
    const namespaces = new Set(facts.map(fact => fact.namespace));

    if (namespaces.size === 1) {
        const byKey: Record<string, string> = {};
        for (const fact of facts) {
            byKey[fact.key] = fact.value;
        }
        return JSON.stringify(byKey, null, 2);
    }

    const byPath: Record<string, string> = {};
    for (const fact of facts) {
        byPath[`${fact.namespace}/${fact.key}`] = fact.value;
    }
    return JSON.stringify(byPath, null, 2);
}

function formatYaml(facts: FactData[]): string {
    const namespaces = new Set(facts.map(fact => fact.namespace));

    if (namespaces.size === 1) {
        const byKey: Record<string, string> = {};
        for (const fact of facts) {
            byKey[fact.key] = fact.value;
        }
        return stringify(byKey);
    }

    const byPath: Record<string, string> = {};
    for (const fact of facts) {
        byPath[`${fact.namespace}/${fact.key}`] = fact.value;
    }
    return stringify(byPath);
}

function formatEnv(facts: FactData[]): string {
    const namespaces = new Set(facts.map(fact => fact.namespace));
    const lines: string[] = [];

    for (const fact of facts) {
        const rawKey = namespaces.size === 1 ? fact.key : `${fact.namespace}_${fact.key}`;
        const envKey = rawKey.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const escapedValue = fact.value.replace(/"/g, '\\"');
        lines.push(`${envKey}="${escapedValue}"`);
    }

    return lines.join('\n');
}

function formatText(facts: FactData[]): string {
    return facts
        .map(fact => {
            const line = `${fact.namespace}/${fact.key}: ${fact.value}`;
            return fact.description ? `${line}\n  description: ${fact.description}` : line;
        })
        .join('\n');
}
