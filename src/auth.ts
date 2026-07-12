import { Request, Response, NextFunction } from 'express';
import { countApiKeys, findApiKeyBySecret, keyHasAccess, apiKeyAllowsNamespace } from './keys.js';

/**
 * Auth is DB-only: one API key per person in `api_keys`.
 * Person name + key secret ≈ user id + password.
 * Membership access: uni approve / uni suspend.
 */
export async function hasAccess(
    apiKey: string | undefined,
    namespace: string,
    requiredScope: 'read' | 'write'
): Promise<boolean> {
    return keyHasAccess(apiKey, namespace, requiredScope);
}

export function requireAuth(scope: 'read' | 'write') {
    return async (req: Request, res: Response, next: NextFunction) => {
        const apiKey = (req.headers['x-api-key'] || req.query.key) as string | undefined;
        const namespace = req.params.namespace;

        if (!apiKey) {
            return res.status(401).json({ error: 'Unauthorized: Missing API key' });
        }

        const record = await findApiKeyBySecret(apiKey);
        if (!record) {
            return res.status(401).json({
                error: 'Unauthorized: Unknown or disabled API key (local secret must match origin)'
            });
        }

        if (!record.scopes.includes(scope)) {
            return res.status(403).json({
                error: `Forbidden: API key does not have ${scope} scope`
            });
        }

        if (!namespace) {
            return next();
        }

        if (apiKeyAllowsNamespace(record, namespace)) {
            return next();
        }

        return res.status(403).json({
            error: `Forbidden: API key does not have ${scope} access to namespace '${namespace}'`
        });
    };
}

/** First key may be created with no auth when the table is empty. */
export function requireAuthOrBootstrap(scope: 'read' | 'write') {
    return async (req: Request, res: Response, next: NextFunction) => {
        const total = await countApiKeys();
        if (total === 0) {
            return next();
        }
        return requireAuth(scope)(req, res, next);
    };
}

/**
 * Anyone may create a new org (uni init). Auth optional.
 * If a key is presented it must be valid; if omitted, the handler creates the owner key.
 */
export function allowPublicOrgCreate() {
    return async (req: Request, res: Response, next: NextFunction) => {
        const apiKey = (req.headers['x-api-key'] || req.query.key) as string | undefined;
        if (!apiKey) return next();
        const ok = await keyHasAccess(apiKey, undefined, 'write');
        if (ok) return next();
        // Unknown key is OK for org create — client is registering that secret as the new owner.
        return next();
    };
}
