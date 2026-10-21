/**
 * UniSpec: a spec is a fact. Chat says `unispec uuid7/java 3`.
 * The CLI says `uni spec uuid7/java 3`. No version means the latest published one.
 */

export class UnispecError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnispecError';
    }
}

export interface UnispecRef {
    subject: string;
    target: string;
    /** Null means the latest published version. */
    version: number | null;
}

export interface SpecFact {
    namespace: string;
    key: string;
    version: number;
    registry_channel: string;
    value: string;
}

export interface FactPath {
    namespace: string;
    key: string;
}

const ID_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const DEFAULT_SPEC_TEMPLATE = [
    'Outcome.',
    '',
    'This version.',
    '',
    'Later.',
    '',
    'Facts to obey.',
    '',
    'Example.',
    '',
    'Checks.',
    '',
    'Constraints.',
    '',
    'Steps.'
].join('\n');

export function parseUnispecInvocation(input: string): UnispecRef {
    const text = input.trim().replace(/\s+/g, ' ');
    if (!text) {
        throw new UnispecError('Say unispec <subject>/<target> and, when you need one, the version.');
    }
    if (text.includes('@')) {
        throw new UnispecError('Put the spec version after a space: unispec uuid7/java 3.');
    }

    let tokens = text.split(' ');
    if (tokens[0].toLowerCase() === 'unispec') tokens = tokens.slice(1);
    if (tokens.length === 0 || tokens.length > 2) {
        throw new UnispecError('Say unispec <subject>/<target> or unispec <subject>/<target> <version>.');
    }

    let version: number | null = null;
    if (tokens.length === 2) {
        if (!/^[1-9][0-9]*$/.test(tokens[1])) {
            throw new UnispecError('The version is a separate word after the spec, such as unispec uuid7/java 3.');
        }
        version = Number(tokens[1]);
    }

    const slash = tokens[0].indexOf('/');
    if (slash <= 0 || slash !== tokens[0].lastIndexOf('/') || slash === tokens[0].length - 1) {
        throw new UnispecError('A spec id is <subject>/<target>, such as uuid7/java.');
    }
    const subject = tokens[0].slice(0, slash);
    const target = tokens[0].slice(slash + 1);
    if (!ID_PART.test(subject) || !ID_PART.test(target)) {
        throw new UnispecError('Subject and target use letters, numbers, dots, underscores, and hyphens.');
    }
    return { subject, target, version };
}

export function specFactPath(ref: Pick<UnispecRef, 'subject' | 'target'>): FactPath {
    return { namespace: `unispec.${ref.subject}`, key: ref.target };
}

export function linkFactPath(ref: Pick<UnispecRef, 'subject' | 'target'>): FactPath {
    return { namespace: `unispec.link.${ref.subject}`, key: ref.target };
}

/** Company template first, then the shared template. */
export function templateFactPaths(company?: string): FactPath[] {
    const shared: FactPath = { namespace: 'unispec.template', key: 'default' };
    const id = company?.trim();
    if (!id) return [shared];
    if (id.includes('/') || /\s/.test(id) || id.startsWith('.')) {
        throw new UnispecError('A company id cannot contain a slash or a space.');
    }
    return [{ namespace: 'unispec.template', key: id }, shared];
}

export function formatSpecCall(ref: UnispecRef): string {
    const id = `${ref.subject}/${ref.target}`;
    return ref.version === null ? `unispec ${id}` : `unispec ${id} ${ref.version}`;
}

export function selectPublishedSpec(versions: SpecFact[], requested: number | null): SpecFact {
    const published = versions.filter((row) => row.registry_channel === 'published');
    if (requested === null) {
        if (published.length === 0) {
            throw new UnispecError('No published version. A draft is not the latest.');
        }
        return published.reduce((best, row) => (row.version > best.version ? row : best));
    }
    const match = published.find((row) => row.version === requested);
    if (match) return match;
    const any = versions.find((row) => row.version === requested);
    if (any) {
        throw new UnispecError(
            `Version ${requested} is ${any.registry_channel}. Publish it before an agent runs it.`
        );
    }
    throw new UnispecError(`Version ${requested} does not exist.`);
}

export function formatLinkValue(input: {
    namespace: string;
    key: string;
    specVersion: number;
    code: string;
}): string {
    const code = input.code.trim();
    if (!code || code.includes('\n')) {
        throw new UnispecError('The code link is one line, such as a commit or a path.');
    }
    return [`spec: ${input.namespace}/${input.key}`, `spec_version: ${input.specVersion}`, `code: ${code}`].join(
        '\n'
    );
}

export function linkSpecVersion(value: string): number | null {
    const match = value.match(/^spec_version:\s*([1-9][0-9]*)\s*$/m);
    return match ? Number(match[1]) : null;
}

export function parseLinkValue(value: string): { spec: string; specVersion: number | null; code: string } {
    const spec = value.match(/^spec:\s*(\S+)\s*$/m)?.[1] ?? '';
    const code = value.match(/^code:\s*(\S.*?)\s*$/m)?.[1]?.trim() ?? '';
    return { spec, specVersion: linkSpecVersion(value), code };
}

/** Letters and digits only. A v before a number is dropped, so uuid-v7 and UUID7 are one capability. */
export function capabilityKey(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .replace(/v(?=\d)/g, '');
}

export function specSubject(namespace: string): string | null {
    if (!namespace.startsWith('unispec.') || namespace.startsWith('unispec.link.') || namespace === 'unispec.template') {
        return null;
    }
    const subject = namespace.slice('unispec.'.length);
    return subject || null;
}

export function linkSubject(namespace: string): string | null {
    if (!namespace.startsWith('unispec.link.')) return null;
    const subject = namespace.slice('unispec.link.'.length);
    return subject || null;
}

function published(rows: SpecFact[]): SpecFact[] {
    return rows.filter((row) => row.registry_channel === 'published');
}

function capabilityTokens(need: string, known: Set<string>): string[] {
    const found = new Set<string>();
    const accept = (name: string) => {
        const key = capabilityKey(name);
        if (known.has(key)) found.add(key);
    };
    for (const match of need.matchAll(/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*/g)) {
        accept(match[0].split('/')[0]);
    }
    for (const match of need.matchAll(/[A-Za-z][A-Za-z0-9]*[\s._-]*v?[\s._-]*\d+/g)) {
        accept(match[0]);
    }
    for (const token of need.split(/[^A-Za-z0-9]+/)) {
        if (token.length >= 4) accept(token);
    }
    return [...found];
}

export type CapabilityAction = 'use_existing' | 'follow_spec' | 'choose' | 'none';

export interface CapabilityDecision {
    action: CapabilityAction;
    matches: Array<{ spec: SpecFact; link: SpecFact | null; code: string | null }>;
    message: string;
}

export function decideCapability(need: string, specs: SpecFact[], links: SpecFact[]): CapabilityDecision {
    const publishedSpecs = published(specs).filter((row) => specSubject(row.namespace));
    const known = new Set(publishedSpecs.map((row) => capabilityKey(specSubject(row.namespace) || '')));
    const wanted = new Set(capabilityTokens(need, known));
    const matched = publishedSpecs.filter((row) => wanted.has(capabilityKey(specSubject(row.namespace) || '')));
    const byCapability = new Map<string, SpecFact>();
    for (const row of matched) {
        const cap = capabilityKey(specSubject(row.namespace) || '');
        const current = byCapability.get(cap);
        if (!current || row.version > current.version) byCapability.set(cap, row);
    }
    const publishedLinks = published(links);
    const matches = [...byCapability.entries()].map(([cap, spec]) => {
        const link = publishedLinks
            .filter((row) => capabilityKey(linkSubject(row.namespace) || '') === cap)
            .reduce<SpecFact | null>((best, row) => (!best || row.version > best.version ? row : best), null);
        return { spec, link, code: link ? parseLinkValue(link.value).code || null : null };
    });
    if (matches.length === 0) {
        return {
            action: 'none',
            matches: [],
            message: 'No published spec matches. Propose a spec from the template before writing code.'
        };
    }
    if (matches.length > 1 || matches.some((match) => publishedLinks.filter((row) => capabilityKey(linkSubject(row.namespace) || '') === capabilityKey(specSubject(match.spec.namespace) || '')).length > 1)) {
        const listed = matches
            .map((match) => `${match.spec.namespace}/${match.spec.key}${match.code ? ` code: ${match.code}` : ''}`)
            .join('; ');
        return {
            action: 'choose',
            matches,
            message: `More than one published spec matches. Use one of these and do not create another: ${listed}.`
        };
    }
    const match = matches[0];
    const id = `${match.spec.namespace}/${match.spec.key}`;
    if (match.code) {
        return {
            action: 'use_existing',
            matches,
            message: `Do not create another implementation. Use ${match.code}. The spec is ${id} version ${match.spec.version}.`
        };
    }
    return {
        action: 'follow_spec',
        matches,
        message: `${id} version ${match.spec.version} is already the spec. Do not create a second spec. Implement this one, then propose one code link.`
    };
}

export function creationBlock(namespace: string, key: string, specs: SpecFact[], links: SpecFact[]): string | null {
    const asSpec = specSubject(namespace);
    if (asSpec) {
        const cap = capabilityKey(asSpec);
        const same = published(specs).filter((row) => capabilityKey(specSubject(row.namespace) || '') === cap);
        const exact = same.some((row) => row.namespace === namespace && row.key === key);
        const other = same.find((row) => row.namespace !== namespace || row.key !== key);
        if (other && !exact) {
            return `Do not create ${namespace}/${key}. ${other.namespace}/${other.key} version ${other.version} is already the spec. Use that.`;
        }
        return null;
    }
    const asLink = linkSubject(namespace);
    if (!asLink) return null;
    const cap = capabilityKey(asLink);
    const spec = published(specs).find((row) => capabilityKey(specSubject(row.namespace) || '') === cap);
    if (!spec) return 'Publish the spec before linking code.';
    const existing = published(links).filter((row) => capabilityKey(linkSubject(row.namespace) || '') === cap);
    const other = existing.find((row) => row.namespace !== namespace || row.key !== key);
    if (other) {
        const code = parseLinkValue(other.value).code;
        return code
            ? `Do not create another implementation. Use ${code}.`
            : `Do not create another implementation. ${other.namespace}/${other.key} is already linked.`;
    }
    return null;
}

export function selectLink(versions: SpecFact[], specVersion: number | null): SpecFact {
    const published = versions.filter((row) => row.registry_channel === 'published');
    const pool =
        specVersion === null
            ? published
            : published.filter((row) => linkSpecVersion(row.value) === specVersion);
    if (pool.length === 0) {
        throw new UnispecError(
            specVersion === null
                ? 'No published code link for this spec.'
                : `No published code link for spec version ${specVersion}.`
        );
    }
    return pool.reduce((best, row) => (row.version > best.version ? row : best));
}

export interface FactSource {
    get(namespace: string, key: string): Promise<SpecFact | null>;
    versions(namespace: string, key: string): Promise<SpecFact[]>;
}

export function specFactFromSnapshot(
    path: FactPath,
    version: number,
    registryChannel: string,
    snapshot: unknown
): SpecFact | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const row = snapshot as { value?: unknown; registry_channel?: unknown; version?: unknown };
    if (typeof row.value !== 'string') return null;
    return {
        namespace: path.namespace,
        key: path.key,
        version: typeof row.version === 'number' ? row.version : version,
        registry_channel: typeof row.registry_channel === 'string' ? row.registry_channel : registryChannel,
        value: row.value
    };
}

function mergeCurrent(current: SpecFact | null, versions: SpecFact[]): SpecFact[] {
    if (!current) return versions;
    if (versions.some((row) => row.version === current.version && row.registry_channel === current.registry_channel)) {
        return versions;
    }
    return [...versions, current];
}

export async function resolveSpec(source: FactSource, ref: UnispecRef): Promise<SpecFact> {
    const path = specFactPath(ref);
    const [current, versions] = await Promise.all([
        source.get(path.namespace, path.key),
        source.versions(path.namespace, path.key)
    ]);
    return selectPublishedSpec(mergeCurrent(current, versions), ref.version);
}

export async function resolveTemplate(
    source: FactSource,
    company?: string
): Promise<{ path: FactPath; value: string; builtin: boolean; fact: SpecFact | null }> {
    for (const path of templateFactPaths(company)) {
        const fact = await source.get(path.namespace, path.key);
        if (fact?.registry_channel === 'published' && fact.value.trim()) {
            return { path, value: fact.value, builtin: false, fact };
        }
    }
    const fallback = templateFactPaths(company).at(-1)!;
    return { path: fallback, value: DEFAULT_SPEC_TEMPLATE, builtin: true, fact: null };
}

export async function resolveLink(source: FactSource, ref: UnispecRef): Promise<SpecFact> {
    const path = linkFactPath(ref);
    const [current, versions] = await Promise.all([
        source.get(path.namespace, path.key),
        source.versions(path.namespace, path.key)
    ]);
    return selectLink(mergeCurrent(current, versions), ref.version);
}
