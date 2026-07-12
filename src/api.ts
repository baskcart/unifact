import 'dotenv/config';
import express, { Request, Response } from 'express';
import { db, AuditLogRow } from './db.js';
import { formatFacts, FormatType, FactData } from './format.js';
import { requireAuth, requireAuthOrBootstrap, hasAccess } from './auth.js';
import {
    createApiKey,
    listApiKeys,
    setApiKeyEnabled
} from './keys.js';
import {
    approveJoin,
    getRegistry,
    initRegistry,
    listJoinRequests,
    listRegistries,
    requestJoin
} from './registry.js';
import {
    approveFact,
    deleteAgentProfile,
    deleteFact,
    factFromRow,
    findRelevantFacts,
    getAgentProfileRow,
    getFactRow,
    getRegistryMetadata,
    getSyncStatus,
    listAgentProfiles,
    listFacts,
    listFactVersions,
    listReviewQueue,
    proposeFactFromProfile,
    publishFact,
    pullFactsForAgent,
    pullFactsFromRemote,
    pushFactsToRemote,
    retractFact,
    rejectFact,
    reviewFact,
    searchFacts,
    supersedeFact,
    upsertAgentProfile,
    upsertFact
} from './store.js';

const app = express();
const PORT = process.env.PORT || 4110;

app.use(express.json());

app.get('/healthz', (_req: Request, res: Response) => {
    return res.json({
        ok: true,
        service: 'unifact',
        backend: db.backend,
        database: db.name
    });
});

app.get('/v1/keys', requireAuthOrBootstrap('read'), async (_req: Request, res: Response) => {
    try {
        const keys = await listApiKeys();
        return res.json({
            keys: keys.map(k => ({
                person: k.person,
                api_key: k.api_key,
                enabled: k.enabled,
                namespaces: k.namespaces,
                scopes: k.scopes,
                updated_at: k.updated_at
            })),
            count: keys.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to list API keys');
    }
});

app.post('/v1/keys', requireAuthOrBootstrap('write'), async (req: Request, res: Response) => {
    try {
        const body = bodyAsRecord(req);
        const person = typeof body.person === 'string' ? body.person : '';
        const namespaces = Array.isArray(body.namespaces)
            ? body.namespaces.map(String)
            : undefined;
        const scopes = Array.isArray(body.scopes)
            ? body.scopes.map(String).filter((s): s is 'read' | 'write' => s === 'read' || s === 'write')
            : undefined;
        const apiKey = typeof body.api_key === 'string' ? body.api_key : undefined;
        const key = await createApiKey({ person, namespaces, scopes, api_key: apiKey });
        console.log(`[unifact] API key upserted for person=${key.person} enabled=${key.enabled}`);
        return res.json({ success: true, key });
    } catch (err) {
        return handleError(res, err, 'Failed to create API key');
    }
});

app.post('/v1/keys/:person/on', requireAuth('write'), async (req: Request, res: Response) => {
    try {
        const key = await setApiKeyEnabled(req.params.person, true);
        return res.json({ success: true, key });
    } catch (err) {
        return handleError(res, err, 'Failed to enable API key');
    }
});

app.post('/v1/keys/:person/off', requireAuth('write'), async (req: Request, res: Response) => {
    try {
        const key = await setApiKeyEnabled(req.params.person, false);
        return res.json({ success: true, key });
    } catch (err) {
        return handleError(res, err, 'Failed to disable API key');
    }
});

app.get('/v1/registries', requireAuthOrBootstrap('read'), async (_req: Request, res: Response) => {
    try {
        const registries = await listRegistries();
        return res.json({ registries, count: registries.length });
    } catch (err) {
        return handleError(res, err, 'Failed to list registries');
    }
});

app.get('/v1/registries/:name', requireAuthOrBootstrap('read'), async (req: Request, res: Response) => {
    try {
        const registry = await getRegistry(req.params.name);
        if (!registry) return res.status(404).json({ error: 'Registry not found' });
        return res.json({ registry });
    } catch (err) {
        return handleError(res, err, 'Failed to load registry');
    }
});

app.post('/v1/registries', requireAuthOrBootstrap('write'), async (req: Request, res: Response) => {
    try {
        const body = bodyAsRecord(req);
        const result = await initRegistry({
            name: String(body.name || ''),
            person: String(body.person || ''),
            description: typeof body.description === 'string' ? body.description : undefined,
            git_url: typeof body.git_url === 'string' ? body.git_url : undefined
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(res, err, 'Failed to init registry');
    }
});

app.post('/v1/registries/:name/join', requireAuthOrBootstrap('write'), async (req: Request, res: Response) => {
    try {
        const body = bodyAsRecord(req);
        const request = await requestJoin({
            registry: req.params.name,
            person: String(body.person || ''),
            message: typeof body.message === 'string' ? body.message : undefined
        });
        return res.json({ success: true, request });
    } catch (err) {
        return handleError(res, err, 'Failed to request join');
    }
});

app.get('/v1/registries/:name/requests', requireAuth('read'), async (req: Request, res: Response) => {
    try {
        const requests = await listJoinRequests(req.params.name);
        return res.json({ requests, count: requests.length });
    } catch (err) {
        return handleError(res, err, 'Failed to list join requests');
    }
});

app.post('/v1/registries/:name/approve', requireAuth('write'), async (req: Request, res: Response) => {
    try {
        const body = bodyAsRecord(req);
        const apiKey = getApiKey(req);
        // approved_by must match owner; prefer body, else look up from key later — require body.person of joiner + approved_by
        const result = await approveJoin({
            registry: req.params.name,
            person: String(body.person || ''),
            approved_by: String(body.approved_by || ''),
            pull: body.pull === true
        });
        void apiKey;
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(res, err, 'Failed to approve join');
    }
});

function getFormat(req: Request): FormatType {
    const format = req.query.format as string | undefined;
    if (format === 'json' || format === 'text' || format === 'yaml' || format === 'env') {
        return format;
    }
    return 'json';
}

function getApiKey(req: Request): string | undefined {
    const headerKey = req.header('x-api-key');
    if (headerKey) {
        return headerKey;
    }

    const queryKey = req.query.key;
    if (typeof queryKey === 'string') {
        return queryKey;
    }

    if (Array.isArray(queryKey)) {
        const first = queryKey[0];
        return typeof first === 'string' ? first : undefined;
    }

    return undefined;
}

function getQueryString(req: Request, name: string): string | undefined {
    const value = req.query[name];
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === 'string' ? first : undefined;
    }
    return undefined;
}

function getQueryBoolean(req: Request, name: string): boolean | undefined {
    const value = getQueryString(req, name);
    if (value === undefined) {
        return undefined;
    }

    return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function getQueryNumber(req: Request, name: string): number | undefined {
    const value = getQueryString(req, name);
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function wantsMetadata(req: Request): boolean {
    return getQueryBoolean(req, 'include_metadata') === true || getQueryBoolean(req, 'metadata') === true;
}

function bodyAsRecord(req: Request): Record<string, unknown> {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new Error('Request body must be a JSON object');
    }

    return req.body as Record<string, unknown>;
}

function sendFormatted(res: Response, facts: FactData[], format: FormatType) {
    const formatted = formatFacts(facts, format);

    if (format === 'json') {
        res.type('application/json');
    } else if (format === 'yaml') {
        res.type('text/yaml');
    } else {
        res.type('text/plain');
    }

    return res.send(formatted);
}

function handleError(res: Response, err: unknown, fallback: string) {
    const message = err instanceof Error ? err.message : fallback;
    console.error(err);
    return res.status(400).json({ error: message });
}

async function filterAuthorized<T>(
    items: T[],
    apiKey: string | undefined,
    namespaceOf: (item: T) => string,
    scope: 'read' | 'write' = 'read'
): Promise<T[]> {
    const out: T[] = [];
    for (const item of items) {
        if (await hasAccess(apiKey, namespaceOf(item), scope)) {
            out.push(item);
        }
    }
    return out;
}

app.get('/v1/agent-profiles', requireAuth('read'), async (_req: Request, res: Response) => {
    try {
        const profiles = await listAgentProfiles();
        return res.json({ profiles, count: profiles.length });
    } catch (err) {
        return handleError(res, err, 'Failed to list agent profiles');
    }
});

app.get('/v1/registry/metadata', requireAuth('read'), async (_req: Request, res: Response) => {
    try {
        return res.json(await getRegistryMetadata());
    } catch (err) {
        return handleError(res, err, 'Failed to load registry metadata');
    }
});

app.get('/v1/agent-profiles/:id', requireAuth('read'), async (req: Request, res: Response) => {
    try {
        const row = await getAgentProfileRow(req.params.id);
        if (!row) {
            return res.status(404).json({ error: `Agent profile '${req.params.id}' not found` });
        }

        const profiles = await listAgentProfiles();
        const profile = profiles.find(item => item.id === req.params.id);
        return res.json({ profile });
    } catch (err) {
        return handleError(res, err, 'Failed to load agent profile');
    }
});

app.get('/v1/agent-profiles/:id/relevant-facts', requireAuth('read'), async (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = await findRelevantFacts({
            profile_id: req.params.id,
            namespace: getQueryString(req, 'namespace'),
            subject: getQueryString(req, 'subject'),
            scope: getQueryString(req, 'scope'),
            intent: getQueryString(req, 'intent'),
            actionability: getQueryString(req, 'actionability'),
            fact_type: getQueryString(req, 'fact_type'),
            status: getQueryString(req, 'status'),
            include_inactive: getQueryBoolean(req, 'include_inactive'),
            include_review: getQueryBoolean(req, 'include_review'),
            limit: getQueryNumber(req, 'limit'),
            query: getQueryString(req, 'q'),
            registry_channel: getQueryString(req, 'registry_channel'),
            published_only: getQueryBoolean(req, 'published_only')
        });

        const results = await filterAuthorized(
            relevance.results,
            apiKey,
            result => result.fact.namespace
        );
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to find relevant facts');
    }
});


app.get('/v1/agent-profiles/:id/pull', requireAuth('read'), async (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = await pullFactsForAgent({
            profile_id: req.params.id,
            namespace: getQueryString(req, 'namespace'),
            subject: getQueryString(req, 'subject'),
            scope: getQueryString(req, 'scope'),
            intent: getQueryString(req, 'intent'),
            actionability: getQueryString(req, 'actionability'),
            fact_type: getQueryString(req, 'fact_type'),
            status: getQueryString(req, 'status'),
            include_inactive: getQueryBoolean(req, 'include_inactive'),
            include_review: getQueryBoolean(req, 'include_review'),
            limit: getQueryNumber(req, 'limit'),
            query: getQueryString(req, 'q')
        });

        const results = await filterAuthorized(
            relevance.results,
            apiKey,
            result => result.fact.namespace
        );
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to pull facts for agent profile');
    }
});
const createOrUpdateAgentProfile = async (req: Request, res: Response) => {
    try {
        const result = await upsertAgentProfile(req.params.id, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: agent profile ${req.params.id}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to upsert agent profile');
    }
};

app.post('/v1/agent-profiles/:id', requireAuth('write'), createOrUpdateAgentProfile);
app.put('/v1/agent-profiles/:id', requireAuth('write'), createOrUpdateAgentProfile);

app.post('/v1/agent-profiles/:id/facts/:namespace/:key', requireAuth('write'), async (req: Request, res: Response) => {
    try {
        const result = await proposeFactFromProfile(req.params.id, req.params.namespace, req.params.key, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: ${req.params.namespace}/${req.params.key} from profile ${req.params.id}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to propose fact from agent profile');
    }
});

app.delete('/v1/agent-profiles/:id', requireAuth('write'), async (req: Request, res: Response) => {
    try {
        const deleted = await deleteAgentProfile(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: `Agent profile '${req.params.id}' not found` });
        }

        console.log(`[unifact] Deleted agent profile: ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        return handleError(res, err, 'Failed to delete agent profile');
    }
});

app.get('/v1/facts/_search', requireAuth('read'), async (req: Request, res: Response) => {
    const query = req.query.q as string | undefined;
    const format = getFormat(req);
    const apiKey = getApiKey(req);

    if (!query) {
        return res.status(400).json({ error: "Missing search term parameter 'q'" });
    }

    try {
        const matches = await searchFacts(query);
        const authorizedMatches = await filterAuthorized(matches, apiKey, match => match.namespace);
        const facts = authorizedMatches.map(factFromRow);

        if (format === 'json') {
            return res.json({
                results: facts,
                count: facts.length
            });
        }

        return sendFormatted(res, facts, format);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Search execution failed' });
    }
});

app.get('/v1/facts/_relevant', requireAuth('read'), async (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = await findRelevantFacts({
            profile_id: getQueryString(req, 'profile_id'),
            namespace: getQueryString(req, 'namespace'),
            subject: getQueryString(req, 'subject'),
            scope: getQueryString(req, 'scope'),
            intent: getQueryString(req, 'intent'),
            actionability: getQueryString(req, 'actionability'),
            fact_type: getQueryString(req, 'fact_type'),
            status: getQueryString(req, 'status'),
            include_inactive: getQueryBoolean(req, 'include_inactive'),
            include_review: getQueryBoolean(req, 'include_review'),
            limit: getQueryNumber(req, 'limit'),
            query: getQueryString(req, 'q'),
            registry_channel: getQueryString(req, 'registry_channel'),
            published_only: getQueryBoolean(req, 'published_only')
        });

        const results = await filterAuthorized(
            relevance.results,
            apiKey,
            result => result.fact.namespace
        );
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to find relevant facts');
    }
});

app.get('/v1/facts/_review-queue', requireAuth('read'), async (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const queue = await listReviewQueue({
            namespace: getQueryString(req, 'namespace'),
            limit: getQueryNumber(req, 'limit')
        });
        const facts = await filterAuthorized(queue.facts, apiKey, fact => fact.namespace);
        return res.json({
            facts,
            count: facts.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to load review queue');
    }
});


app.get('/v1/facts/:namespace/:key/versions', requireAuth('read'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const versions = await listFactVersions(namespace, key);
        return res.json({ namespace, key, versions, count: versions.length });
    } catch (err) {
        return handleError(res, err, 'Failed to load fact versions');
    }
});

app.post('/v1/facts/:namespace/:key/review', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await reviewFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to review fact');
    }
});

app.post('/v1/facts/:namespace/:key/approve', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await approveFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to approve fact');
    }
});

app.post('/v1/facts/:namespace/:key/reject', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await rejectFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to reject fact');
    }
});

app.post('/v1/facts/:namespace/:key/publish', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await publishFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to publish fact');
    }
});

app.post('/v1/facts/:namespace/:key/supersede', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await supersedeFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to supersede fact');
    }
});

app.post('/v1/facts/:namespace/:key/retract', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(await retractFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to retract fact');
    }
});
app.get('/v1/facts/:namespace/:key/audit', requireAuth('read'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const logs = await db.all<AuditLogRow>(`
          SELECT id, action, namespace, key, old_value, new_value,
                 old_snapshot, new_snapshot, timestamp
          FROM audit_log
          WHERE namespace = ? AND key = ?
          ORDER BY timestamp DESC
        `, [namespace, key]);

        return res.json({
            namespace,
            key,
            history: logs,
            count: logs.length
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

app.get('/v1/facts/:namespace/:key', requireAuth('read'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;
    const format = getFormat(req);

    try {
        const row = await getFactRow(namespace, key);
        if (!row) {
            return res.status(404).json({ error: `Fact '${key}' not found in namespace '${namespace}'` });
        }

        const fact = factFromRow(row);
        if (format === 'json') {
            return res.json({ fact });
        }

        return sendFormatted(res, [fact], format);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

app.get('/v1/facts/:namespace', requireAuth('read'), async (req: Request, res: Response) => {
    const { namespace } = req.params;
    const format = getFormat(req);

    try {
        const registryChannel = getQueryString(req, 'registry_channel');
        const rows = registryChannel
            ? (await listFacts(namespace)).filter(row => row.registry_channel === registryChannel)
            : await listFacts(namespace);
        const facts = rows.map(factFromRow);

        if (format === 'json' && wantsMetadata(req)) {
            return res.json({ namespace, facts, count: facts.length });
        }

        return sendFormatted(res, facts, format);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

app.post('/v1/facts/_batch', async (req: Request, res: Response) => {
    const { namespaces } = req.body;
    const format = getFormat(req);
    const apiKey = getApiKey(req);

    if (!namespaces || !Array.isArray(namespaces)) {
        return res.status(400).json({ error: "Missing array 'namespaces' in request body" });
    }

    for (const namespace of namespaces) {
        if (!(await hasAccess(apiKey, namespace, 'read'))) {
            return res.status(403).json({ error: `Forbidden: API key does not have read access to namespace '${namespace}'` });
        }
    }

    try {
        const facts = (await Promise.all(
            namespaces.map(async namespace => (await listFacts(String(namespace))).map(factFromRow))
        )).flat();

        if (format === 'json' && wantsMetadata(req)) {
            return res.json({ facts, count: facts.length });
        }

        return sendFormatted(res, facts, format);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

const createOrUpdateFact = async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const result = await upsertFact(namespace, key, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: ${namespace}/${key}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to upsert fact');
    }
};

app.post('/v1/facts/:namespace/:key', requireAuth('write'), createOrUpdateFact);
app.put('/v1/facts/:namespace/:key', requireAuth('write'), createOrUpdateFact);

app.delete('/v1/facts/:namespace/:key', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const deleted = await deleteFact(namespace, key);
        if (!deleted) {
            return res.status(404).json({ error: `Fact '${key}' not found in namespace '${namespace}'` });
        }

        console.log(`[unifact] Deleted: ${namespace}/${key}`);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

// Backward-compatible upstream staging endpoints.
app.get('/v1/sync/status', requireAuth('read'), async (req: Request, res: Response) => {
    try {
        const status = await getSyncStatus();
        return res.json(status);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to get sync status' });
    }
});

app.post('/v1/sync/pull', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespaces } = req.body;

    try {
        const result = await pullFactsFromRemote(namespaces);
        console.log(`[unifact] Upstream pull: ${result.pulled} pulled, ${result.skipped} skipped, ${result.conflicts} conflicts`);
        return res.json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Pull failed' });
    }
});

app.post('/v1/sync/push', requireAuth('write'), async (req: Request, res: Response) => {
    const { namespaces } = req.body;

    try {
        const result = await pushFactsToRemote(namespaces);
        console.log(`[unifact] Upstream push: ${result.pushed} pushed, ${result.failed} failed`);
        return res.json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Push failed' });
    }
});

app.listen(PORT, () => {
    console.log(`UniFact fact store server active at http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database backend: ${db.backend} (${db.name})`);
});
