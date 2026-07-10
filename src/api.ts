import 'dotenv/config';
import express, { Request, Response } from 'express';
import { db, AuditLogRow } from './db.js';
import { formatFacts, FormatType, FactData } from './format.js';
import { requireAuth, hasAccess } from './auth.js';
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
        database: db.name
    });
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

app.get('/v1/agent-profiles', requireAuth('read'), (_req: Request, res: Response) => {
    try {
        const profiles = listAgentProfiles();
        return res.json({ profiles, count: profiles.length });
    } catch (err) {
        return handleError(res, err, 'Failed to list agent profiles');
    }
});

app.get('/v1/registry/metadata', requireAuth('read'), (_req: Request, res: Response) => {
    try {
        return res.json(getRegistryMetadata());
    } catch (err) {
        return handleError(res, err, 'Failed to load registry metadata');
    }
});

app.get('/v1/agent-profiles/:id', requireAuth('read'), (req: Request, res: Response) => {
    try {
        const row = getAgentProfileRow(req.params.id);
        if (!row) {
            return res.status(404).json({ error: `Agent profile '${req.params.id}' not found` });
        }

        const profile = listAgentProfiles().find(item => item.id === req.params.id);
        return res.json({ profile });
    } catch (err) {
        return handleError(res, err, 'Failed to load agent profile');
    }
});

app.get('/v1/agent-profiles/:id/relevant-facts', requireAuth('read'), (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = findRelevantFacts({
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

        const results = relevance.results.filter(result => hasAccess(apiKey, result.fact.namespace, 'read'));
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to find relevant facts');
    }
});


app.get('/v1/agent-profiles/:id/pull', requireAuth('read'), (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = pullFactsForAgent({
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

        const results = relevance.results.filter(result => hasAccess(apiKey, result.fact.namespace, 'read'));
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to pull facts for agent profile');
    }
});
const createOrUpdateAgentProfile = (req: Request, res: Response) => {
    try {
        const result = upsertAgentProfile(req.params.id, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: agent profile ${req.params.id}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to upsert agent profile');
    }
};

app.post('/v1/agent-profiles/:id', requireAuth('write'), createOrUpdateAgentProfile);
app.put('/v1/agent-profiles/:id', requireAuth('write'), createOrUpdateAgentProfile);

app.post('/v1/agent-profiles/:id/facts/:namespace/:key', requireAuth('write'), (req: Request, res: Response) => {
    try {
        const result = proposeFactFromProfile(req.params.id, req.params.namespace, req.params.key, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: ${req.params.namespace}/${req.params.key} from profile ${req.params.id}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to propose fact from agent profile');
    }
});

app.delete('/v1/agent-profiles/:id', requireAuth('write'), (req: Request, res: Response) => {
    try {
        const deleted = deleteAgentProfile(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: `Agent profile '${req.params.id}' not found` });
        }

        console.log(`[unifact] Deleted agent profile: ${req.params.id}`);
        return res.json({ success: true });
    } catch (err) {
        return handleError(res, err, 'Failed to delete agent profile');
    }
});

app.get('/v1/facts/_search', requireAuth('read'), (req: Request, res: Response) => {
    const query = req.query.q as string | undefined;
    const format = getFormat(req);
    const apiKey = getApiKey(req);

    if (!query) {
        return res.status(400).json({ error: "Missing search term parameter 'q'" });
    }

    try {
        const matches = searchFacts(query);
        const authorizedMatches = matches.filter(match => hasAccess(apiKey, match.namespace, 'read'));
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

app.get('/v1/facts/_relevant', requireAuth('read'), (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const relevance = findRelevantFacts({
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

        const results = relevance.results.filter(result => hasAccess(apiKey, result.fact.namespace, 'read'));
        return res.json({
            profile: relevance.profile,
            results,
            count: results.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to find relevant facts');
    }
});

app.get('/v1/facts/_review-queue', requireAuth('read'), (req: Request, res: Response) => {
    const apiKey = getApiKey(req);

    try {
        const queue = listReviewQueue({
            namespace: getQueryString(req, 'namespace'),
            limit: getQueryNumber(req, 'limit')
        });
        const facts = queue.facts.filter(fact => hasAccess(apiKey, fact.namespace, 'read'));
        return res.json({
            facts,
            count: facts.length
        });
    } catch (err) {
        return handleError(res, err, 'Failed to load review queue');
    }
});


app.get('/v1/facts/:namespace/:key/versions', requireAuth('read'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const versions = listFactVersions(namespace, key);
        return res.json({ namespace, key, versions, count: versions.length });
    } catch (err) {
        return handleError(res, err, 'Failed to load fact versions');
    }
});

app.post('/v1/facts/:namespace/:key/review', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(reviewFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to review fact');
    }
});

app.post('/v1/facts/:namespace/:key/approve', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(approveFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to approve fact');
    }
});

app.post('/v1/facts/:namespace/:key/reject', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(rejectFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to reject fact');
    }
});

app.post('/v1/facts/:namespace/:key/publish', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(publishFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to publish fact');
    }
});

app.post('/v1/facts/:namespace/:key/supersede', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(supersedeFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to supersede fact');
    }
});

app.post('/v1/facts/:namespace/:key/retract', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        return res.json(retractFact(namespace, key, bodyAsRecord(req)));
    } catch (err) {
        return handleError(res, err, 'Failed to retract fact');
    }
});
app.get('/v1/facts/:namespace/:key/audit', requireAuth('read'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const logs = db.prepare(`
          SELECT id, action, namespace, key, old_value, new_value,
                 old_snapshot, new_snapshot, timestamp
          FROM audit_log
          WHERE namespace = ? AND key = ?
          ORDER BY timestamp DESC
        `).all(namespace, key) as AuditLogRow[];

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

app.get('/v1/facts/:namespace/:key', requireAuth('read'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;
    const format = getFormat(req);

    try {
        const row = getFactRow(namespace, key);
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

app.get('/v1/facts/:namespace', requireAuth('read'), (req: Request, res: Response) => {
    const { namespace } = req.params;
    const format = getFormat(req);

    try {
        const registryChannel = getQueryString(req, 'registry_channel');
        const rows = registryChannel
            ? listFacts(namespace).filter(row => row.registry_channel === registryChannel)
            : listFacts(namespace);
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

app.post('/v1/facts/_batch', (req: Request, res: Response) => {
    const { namespaces } = req.body;
    const format = getFormat(req);
    const apiKey = getApiKey(req);

    if (!namespaces || !Array.isArray(namespaces)) {
        return res.status(400).json({ error: "Missing array 'namespaces' in request body" });
    }

    for (const namespace of namespaces) {
        if (!hasAccess(apiKey, namespace, 'read')) {
            return res.status(403).json({ error: `Forbidden: API key does not have read access to namespace '${namespace}'` });
        }
    }

    try {
        const facts = namespaces.flatMap(namespace => listFacts(String(namespace)).map(factFromRow));

        if (format === 'json' && wantsMetadata(req)) {
            return res.json({ facts, count: facts.length });
        }

        return sendFormatted(res, facts, format);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal database error' });
    }
});

const createOrUpdateFact = (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const result = upsertFact(namespace, key, bodyAsRecord(req));
        console.log(`[unifact] ${result.action}: ${namespace}/${key}`);
        return res.json(result);
    } catch (err) {
        return handleError(res, err, 'Failed to upsert fact');
    }
};

app.post('/v1/facts/:namespace/:key', requireAuth('write'), createOrUpdateFact);
app.put('/v1/facts/:namespace/:key', requireAuth('write'), createOrUpdateFact);

app.delete('/v1/facts/:namespace/:key', requireAuth('write'), (req: Request, res: Response) => {
    const { namespace, key } = req.params;

    try {
        const deleted = deleteFact(namespace, key);
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
app.get('/v1/sync/status', requireAuth('read'), (req: Request, res: Response) => {
    try {
        const status = getSyncStatus();
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
    console.log(`Database file: ${db.name}`);
});
