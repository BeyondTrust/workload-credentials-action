// Property-based tests (fuzzing) over the parsers that handle untrusted input.
// fast-check is also what OSSF Scorecard's Fuzzing check detects for TypeScript,
// so keep these tests (and the dependency) in place.
import fc from 'fast-check';
import { parsePath } from '../src/client';
import { parseSecretInput } from '../src/main';

// Mirrors SECRET_PATH_REGEX segment charset and the identifier rules in src/main.ts.
const PATH_SEGMENT = /^[a-zA-Z0-9\-_@~*^%]+$/;
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const segmentsArb = fc.array(fc.stringMatching(PATH_SEGMENT), { minLength: 1, maxLength: 5 });

describe('parsePath properties', () => {
  test('never throws and the name never contains a slash', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const { name } = parsePath(input);
        expect(name).not.toContain('/');
      }),
    );
  });

  test('splits any well-formed path into its folder and final segment', () => {
    fc.assert(
      fc.property(segmentsArb, fc.boolean(), (segments, leadingSlash) => {
        const path = (leadingSlash ? '/' : '') + segments.join('/');
        const { folder, name } = parsePath(path);
        expect(name).toBe(segments[segments.length - 1]);
        expect(folder).toBe(segments.slice(0, -1).join('/'));
      }),
    );
  });

  test('ignores trailing slashes', () => {
    fc.assert(
      fc.property(segmentsArb, fc.integer({ min: 1, max: 3 }), (segments, slashes) => {
        const path = segments.join('/');
        expect(parsePath(path + '/'.repeat(slashes))).toEqual(parsePath(path));
      }),
    );
  });
});

describe('parseSecretInput properties', () => {
  test('any string input either parses to a list or throws an Error', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        try {
          expect(Array.isArray(parseSecretInput(input))).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
    );
  });

  const aliasEntryArb = fc.record(
    {
      path: segmentsArb.map((segments) => segments.join('/')),
      key: fc.stringMatching(IDENTIFIER),
      'output-name': fc.stringMatching(IDENTIFIER),
      'export-to-env': fc.boolean(),
    },
    { requiredKeys: ['path', 'key'] },
  );

  test('accepts alias-mode entries and resolves alias and defaults', () => {
    fc.assert(
      fc.property(fc.array(aliasEntryArb, { minLength: 1, maxLength: 5 }), (entries) => {
        const requests = parseSecretInput(JSON.stringify(entries));
        expect(requests).toHaveLength(entries.length);

        requests.forEach((request, i) => {
          expect(request.path).toBe(entries[i].path);
          expect(request.key).toBe(entries[i].key);
          expect(request.prefix).toBe('');
          expect(request.alias).toBe(entries[i]['output-name'] ?? '');
          expect(request.exportToEnv).toBe(entries[i]['export-to-env'] ?? false);
        });
      }),
    );
  });

  const prefixEntryArb = fc.record(
    {
      path: segmentsArb.map((segments) => segments.join('/')),
      key: fc.stringMatching(IDENTIFIER),
      'output-name': fc.stringMatching(IDENTIFIER).map((name) => `${name}*`),
    },
    { requiredKeys: ['path', 'output-name'] },
  );

  test('accepts prefix-mode entries and never sets both alias and prefix', () => {
    fc.assert(
      fc.property(fc.array(prefixEntryArb, { minLength: 1, maxLength: 5 }), (entries) => {
        const requests = parseSecretInput(JSON.stringify(entries));

        requests.forEach((request, i) => {
          expect(request.prefix).toBe(entries[i]['output-name'].slice(0, -1));
          expect(request.alias).toBe('');
        });
      }),
    );
  });
});
