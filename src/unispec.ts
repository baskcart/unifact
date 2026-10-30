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

const LANGUAGE_NAMES = ['java', 'typescript', 'javascript', 'rust', 'python', 'go'];

function latestFact(rows: SpecFact[]): SpecFact | null {
    return rows.reduce<SpecFact | null>((best, row) => (!best || row.version > best.version ? row : best), null);
}

function linksForCapability(links: SpecFact[], cap: string): SpecFact[] {
    return links.filter((row) => capabilityKey(linkSubject(row.namespace) || '') === cap);
}

/** A language word in the need selects that code link. ts and js are aliases. */
export function requestedLanguage(need: string): string | null {
    const aliases: Record<string, string> = { ts: 'typescript', js: 'javascript' };
    const tokens = need.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const token of tokens) {
        const name = aliases[token] || token;
        if (LANGUAGE_NAMES.includes(name)) return name;
    }
    return null;
}

function linkCode(link: SpecFact | null): string | null {
    return link ? parseLinkValue(link.value).code || null : null;
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
    if (byCapability.size === 0) {
        return {
            action: 'none',
            matches: [],
            message: 'No published spec matches. Propose a spec from the template before writing code.'
        };
    }
    if (byCapability.size > 1) {
        const listed = [...byCapability.values()]
            .map((spec) => `${spec.namespace}/${spec.key}`)
            .join('; ');
        return {
            action: 'choose',
            matches: [...byCapability.values()].map((spec) => ({ spec, link: null, code: null })),
            message: `More than one published spec matches. Use one of these and do not create another: ${listed}.`
        };
    }
    const spec = [...byCapability.values()][0];
    const cap = capabilityKey(specSubject(spec.namespace) || '');
    const capLinks = linksForCapability(publishedLinks, cap);
    const id = `${spec.namespace}/${spec.key}`;
    const language = requestedLanguage(need);
    if (language) {
        const link = latestFact(capLinks.filter((row) => row.key.toLowerCase() === language));
        const code = linkCode(link);
        if (code) {
            return {
                action: 'use_existing',
                matches: [{ spec, link, code }],
                message: `Do not create another ${language} implementation. Use ${code}. The spec is ${id} version ${spec.version}.`
            };
        }
        return {
            action: 'follow_spec',
            matches: [{ spec, link: null, code: null }],
            message: `${id} version ${spec.version} is the spec. Implement it in ${language}, then propose one code link at unispec.link.${specSubject(spec.namespace)}/${language}.`
        };
    }
    if (capLinks.length > 1) {
        const listed = capLinks
            .map((link) => `${link.key}: ${linkCode(link) || link.namespace + '/' + link.key}`)
            .join('; ');
        return {
            action: 'choose',
            matches: capLinks.map((link) => ({ spec, link, code: linkCode(link) })),
            message: `This spec has more than one language. Use one of these and do not create another: ${listed}.`
        };
    }
    const link = latestFact(capLinks);
    const code = linkCode(link);
    if (code) {
        return {
            action: 'use_existing',
            matches: [{ spec, link, code }],
            message: `Do not create another implementation. Use ${code}. The spec is ${id} version ${spec.version}.`
        };
    }
    return {
        action: 'follow_spec',
        matches: [{ spec, link: null, code: null }],
        message: `${id} version ${spec.version} is already the spec. Do not create a second spec. Implement this one, then propose one code link.`
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

/** `spec: unispec.uuid7/java` on a link points back at that spec. */
export function refFromSpecLine(spec: string, version: number | null): UnispecRef {
    const slash = spec.lastIndexOf('/');
    const namespace = slash > 0 ? spec.slice(0, slash) : '';
    const key = slash > 0 ? spec.slice(slash + 1) : '';
    const subject = namespace.startsWith('unispec.') ? namespace.slice('unispec.'.length) : '';
    if (!subject || subject.startsWith('link.') || !ID_PART.test(subject) || !ID_PART.test(key)) {
        throw new UnispecError('The link does not name a spec.');
    }
    return { subject, target: key, version };
}

/**
 * `unispec uuid7/java` reads that spec and the java link.
 * `unispec uuid7/typescript` reads the typescript link and the spec that link names.
 */
export async function resolveUnispecCall(
    source: FactSource,
    ref: UnispecRef
): Promise<{ spec: SpecFact; code: string | null }> {
    try {
        const spec = await resolveSpec(source, ref);
        let code: string | null = null;
        try {
            code = parseLinkValue((await resolveLink(source, ref)).value).code || null;
        } catch (error) {
            if (!(error instanceof UnispecError)) throw error;
        }
        return { spec, code };
    } catch (error) {
        if (!(error instanceof UnispecError)) throw error;
        let link: SpecFact;
        try {
            link = await resolveLink(source, ref);
        } catch {
            throw error;
        }
        const parsed = parseLinkValue(link.value);
        const spec = await resolveSpec(source, refFromSpecLine(parsed.spec, parsed.specVersion));
        return { spec, code: parsed.code || null };
    }
}
