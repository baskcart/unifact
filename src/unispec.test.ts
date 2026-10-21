import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    capabilityKey,
    creationBlock,
    decideCapability,
    formatLinkValue,
    linkSpecVersion,
    parseUnispecInvocation,
    resolveSpec,
    resolveTemplate,
    selectLink,
    selectPublishedSpec,
    specFactPath,
    templateFactPaths,
    type SpecFact
} from './unispec.js';

function fact(partial: Partial<SpecFact> & Pick<SpecFact, 'version' | 'registry_channel'>): SpecFact {
    return {
        namespace: 'unispec.uuid7',
        key: 'java',
        value: `v${partial.version}`,
        ...partial
    };
}

describe('unispec invocation', () => {
    it('reads a spec id and a separate version', () => {
        assert.deepEqual(parseUnispecInvocation('unispec uuid7/java 3'), {
            subject: 'uuid7',
            target: 'java',
            version: 3
        });
        assert.deepEqual(parseUnispecInvocation('uuid7/java'), {
            subject: 'uuid7',
            target: 'java',
            version: null
        });
    });

    it('rejects an @ version because that reads as a language version', () => {
        assert.throws(() => parseUnispecInvocation('uuid7/java@3'), /after a space/);
    });

    it('maps the id onto a fact', () => {
        assert.deepEqual(specFactPath({ subject: 'uuid7', target: 'java' }), {
            namespace: 'unispec.uuid7',
            key: 'java'
        });
    });
});

describe('published spec selection', () => {
    const rows = [
        fact({ version: 1, registry_channel: 'published' }),
        fact({ version: 2, registry_channel: 'published' }),
        fact({ version: 3, registry_channel: 'proposed', value: 'draft' })
    ];

    it('uses the latest published version when none is named', () => {
        assert.equal(selectPublishedSpec(rows, null).version, 2);
    });

    it('uses the named published version', () => {
        assert.equal(selectPublishedSpec(rows, 1).version, 1);
    });

    it('refuses a draft when that version is named', () => {
        assert.throws(() => selectPublishedSpec(rows, 3), /proposed/);
    });
});

describe('templates', () => {
    it('tries the company template before the shared one', () => {
        assert.deepEqual(templateFactPaths('acme.com'), [
            { namespace: 'unispec.template', key: 'acme.com' },
            { namespace: 'unispec.template', key: 'default' }
        ]);
    });

    it('returns the published company template', async () => {
        const company = fact({
            namespace: 'unispec.template',
            key: 'acme.com',
            version: 1,
            registry_channel: 'published',
            value: 'company steps'
        });
        const resolved = await resolveTemplate(
            {
                async get(namespace, key) {
                    return namespace === company.namespace && key === company.key ? company : null;
                },
                async versions() {
                    return [];
                }
            },
            'acme.com'
        );
        assert.equal(resolved.builtin, false);
        assert.equal(resolved.value, 'company steps');
    });

    it('falls back to the built-in sections', async () => {
        const resolved = await resolveTemplate({
            async get() {
                return null;
            },
            async versions() {
                return [];
            }
        });
        assert.equal(resolved.builtin, true);
        assert.match(resolved.value, /Checks\./);
        assert.match(resolved.value, /Steps\./);
    });
});

describe('one implementation', () => {
    const spec = fact({
        namespace: 'unispec.uuid7',
        key: 'java',
        version: 2,
        registry_channel: 'published',
        value: 'Outcome.\nGenerate a UUID version 7.'
    });
    const link = fact({
        namespace: 'unispec.link.uuid7',
        key: 'java',
        version: 1,
        registry_channel: 'published',
        value: formatLinkValue({
            namespace: 'unispec.uuid7',
            key: 'java',
            specVersion: 2,
            code: 'git:https://github.com/baskcart/unifact@abc123:examples/unispec/uuid7/Uuid7.java'
        })
    });

    it('treats uuid-v7 and UUID7 as the same capability', () => {
        assert.equal(capabilityKey('UUID-7'), capabilityKey('uuid v7'));
        assert.equal(capabilityKey('uuid7'), 'uuid7');
    });

    it('sends a later need to the existing code', () => {
        const decision = decideCapability('the order id needs a uuid v7', [spec], [link]);
        assert.equal(decision.action, 'use_existing');
        assert.match(decision.message, /Do not create another implementation/);
        assert.match(decision.message, /Uuid7\.java/);
    });

    it('follows the spec when code is not linked yet', () => {
        const decision = decideCapability('uuid7', [spec], []);
        assert.equal(decision.action, 'follow_spec');
        assert.match(decision.message, /already the spec/);
    });

    it('refuses a second spec and a second implementation', () => {
        assert.match(
            creationBlock('unispec.uuid-7', 'java', [spec], [link]) || '',
            /already the spec/
        );
        assert.match(
            creationBlock('unispec.link.uuid7', 'python', [spec], [link]) || '',
            /Use git:/
        );
        assert.equal(creationBlock('unispec.uuid7', 'java', [spec], [link]), null);
        assert.equal(creationBlock('company.guidelines', 'hours', [spec], [link]), null);
    });
});

describe('code link', () => {
    it('records the spec version on its own line', () => {
        const value = formatLinkValue({
            namespace: 'unispec.uuid7',
            key: 'java',
            specVersion: 3,
            code: 'abc1234'
        });
        assert.equal(linkSpecVersion(value), 3);
        const linked = fact({ version: 4, registry_channel: 'published', value });
        assert.equal(selectLink([linked], 3).version, 4);
        assert.throws(() => selectLink([linked], 2), /version 2/);
    });
});

describe('resolve spec', () => {
    it('returns the latest published fact for an id with no version', async () => {
        const published = fact({ version: 2, registry_channel: 'published', value: 'ship it' });
        const resolved = await resolveSpec(
            {
                async get() {
                    return fact({ version: 3, registry_channel: 'proposed', value: 'draft' });
                },
                async versions() {
                    return [fact({ version: 1, registry_channel: 'published' }), published];
                }
            },
            { subject: 'uuid7', target: 'java', version: null }
        );
        assert.equal(resolved.value, 'ship it');
        assert.equal(resolved.version, 2);
    });
});
