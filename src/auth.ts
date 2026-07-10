import { Request, Response, NextFunction } from 'express';

interface ApiKeyConfig {
    namespaces: string[]; // e.g. ["company.decisions", "company.public"] or ["*"] for wildcard
    scopes: ('read' | 'write')[];
}

const MASTER_KEY = process.env.UNIFACT_MASTER_KEY || 'dev-key-123';

// Load key configurations from env
let API_KEYS: Record<string, ApiKeyConfig> = {};
try {
    if (process.env.UNIFACT_API_KEYS) {
        API_KEYS = JSON.parse(process.env.UNIFACT_API_KEYS);
    }
} catch (err) {
    console.error('Failed to parse UNIFACT_API_KEYS env variable. Ensure it is valid JSON.', err);
}

/**
 * Verifies if the given API key has access to the namespace with the required scope.
 */
export function hasAccess(apiKey: string | undefined, namespace: string, requiredScope: 'read' | 'write'): boolean {
    if (!apiKey) return false;

    // Master key has full access
    if (apiKey === MASTER_KEY) {
        return true;
    }

    const config = API_KEYS[apiKey];
    if (!config) return false;

    // Check scope
    if (!config.scopes.includes(requiredScope)) return false;

    // Check namespace (support exact matches or prefixes or wildcard)
    return config.namespaces.some(allowedNs => {
        if (allowedNs === '*') return true;
        // Prefix matching for dot-nested namespaces: e.g., "company.*" matches "company.decisions"
        if (allowedNs.endsWith('.*')) {
            const prefix = allowedNs.slice(0, -2);
            return namespace === prefix || namespace.startsWith(prefix + '.');
        }
        return namespace === allowedNs;
    });
}

/**
 * Express middleware to enforce auth.
 */
export function requireAuth(scope: 'read' | 'write') {
    return (req: Request, res: Response, next: NextFunction) => {
        const apiKey = (req.headers['x-api-key'] || req.query.key) as string | undefined;
        const namespace = req.params.namespace;

        // If it's a batch call or search, check authorization inside the controller,
        // or check authorization based on whether the key exists at all.
        if (!namespace) {
            // For general endpoints like /_search, check if the key is valid for *something*
            if (apiKey === MASTER_KEY || (apiKey && API_KEYS[apiKey])) {
                return next();
            }
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid API key' });
        }

        if (hasAccess(apiKey, namespace, scope)) {
            return next();
        }

        return res.status(403).json({ error: `Forbidden: API key does not have ${scope} access to namespace '${namespace}'` });
    };
}
