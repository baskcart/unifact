/**
 * Point-in-time reconstruction from fact_versions.
 *
 * Rule: among versions with created_at <= T, take the latest whose registry_channel
 * is a production-lifecycle channel (published | superseded | retracted).
 * If none, the fact was never published as of T → null.
 */

import type { FactResponse, FactVersionResponse } from './model.js';
import { normalizeTimestamp } from './model.js';

/** Channels that mean the fact entered (or left) production truth. */
export const AS_OF_LIVE_CHANNELS = ['published', 'superseded', 'retracted'] as const;

export type AsOfLiveChannel = (typeof AS_OF_LIVE_CHANNELS)[number];

export type AsOfVersionLike = {
    id: number;
    created_at: number;
    registry_channel: string;
    event?: string;
    snapshot: unknown;
    author?: string | null;
    change_reason?: string | null;
    version?: number;
};

export type FactAsOfResult = {
    at: number;
    at_iso: string;
    found: boolean;
    /** Snapshot fact as of T, or null if never published by T */
    fact: FactResponse | null;
    /** Version row used for reconstruction */
    version: FactVersionResponse | null;
    /**
     * published = live production truth at T
     * superseded | retracted = was published earlier, then superseded/retracted by T
     * none = never published as of T
     */
    as_of_status: AsOfLiveChannel | 'none';
};

export function parseAsOfTimestamp(at: unknown): number {
    const ms = normalizeTimestamp(at, 'at');
    if (ms === null) {
        throw new Error('at is required (unix ms or ISO-8601 datetime)');
    }
    return ms;
}

/** Prefer `as_of` over `at` (HTTP/MCP query parity). Empty string ignored. */
export function pickAsOfArg(input: { at?: unknown; as_of?: unknown }): unknown | undefined {
    for (const v of [input.as_of, input.at]) {
        if (v === undefined || v === null || v === '') continue;
        return v;
    }
    return undefined;
}

export function isAsOfLiveChannel(channel: string): channel is AsOfLiveChannel {
    return (AS_OF_LIVE_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Pick the latest production-lifecycle version at or before `atMs`.
 * Prefer higher created_at, then higher id.
 */
export function selectVersionAsOf(
    versions: AsOfVersionLike[],
    atMs: number
): AsOfVersionLike | null {
    const eligible = versions.filter(
        (v) => v.created_at <= atMs && isAsOfLiveChannel(v.registry_channel)
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at - a.created_at;
        return b.id - a.id;
    });
    return eligible[0];
}

export function snapshotToFact(snapshot: unknown): FactResponse | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    return snapshot as FactResponse;
}

export function buildFactAsOfResult(
    versions: AsOfVersionLike[],
    at: unknown,
    meta?: { registry_name?: string; namespace?: string; key?: string }
): FactAsOfResult {
    const atMs = parseAsOfTimestamp(at);
    const picked = selectVersionAsOf(versions, atMs);
    if (!picked) {
        return {
            at: atMs,
            at_iso: new Date(atMs).toISOString(),
            found: false,
            fact: null,
            version: null,
            as_of_status: 'none'
        };
    }

    const fact = snapshotToFact(picked.snapshot);
    const channel = picked.registry_channel as AsOfLiveChannel;
    const version: FactVersionResponse = {
        id: picked.id,
        registry_name: meta?.registry_name || (fact?.registry_name ?? ''),
        namespace: meta?.namespace || (fact?.namespace ?? ''),
        key: meta?.key || (fact?.key ?? ''),
        version: picked.version ?? fact?.version ?? 0,
        event: picked.event ?? 'publish',
        registry_channel: picked.registry_channel,
        snapshot: picked.snapshot,
        author: picked.author ?? null,
        change_reason: picked.change_reason ?? null,
        created_at: picked.created_at
    };

    return {
        at: atMs,
        at_iso: new Date(atMs).toISOString(),
        found: true,
        fact,
        version,
        as_of_status: channel
    };
}

/** Actor from a fact snapshot (for audit backfill). */
export function actorFromFactSnapshot(snapshot: unknown): string | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const s = snapshot as Record<string, unknown>;
    for (const key of ['published_by', 'approved_by', 'created_by']) {
        const v = s[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}
