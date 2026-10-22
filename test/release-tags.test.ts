import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

// Tests for how the Release workflow creates the version tag and moves the
// floating v{major} and v{major}.{minor} tags: the jobs that gate the tag
// jobs, the tag jobs themselves, and the publish job that depends on them.
// Also tests how the release PR is kept from being updated before the
// version tag exists: the check-version-tag and release-pr jobs. Most of
// these jobs only run during a real release, so the tests check their
// definitions and run their inline scripts against a mocked GitHub API.

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  'continue-on-error'?: boolean | string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
}

interface Job {
  needs?: string | string[];
  if?: string;
  environment?: string;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  'continue-on-error'?: boolean | string;
  steps: Step[];
}

const root = join(__dirname, '..');
const workflowText = readFileSync(join(root, '.github', 'workflows', 'release.yaml'), 'utf8');
const workflow = load(workflowText) as { jobs: Record<string, Job> };
const securityGateAction = load(
  readFileSync(join(root, '.github', 'actions', 'security-gate', 'action.yml'), 'utf8'),
) as { runs: { steps: Step[] } };
const releasePleaseConfig = JSON.parse(readFileSync(join(root, 'release-please-config.json'), 'utf8'));

const appSteps = (job: Job) => ({
  tokenStep: job.steps.find((s) => s.id === 'app-token') as Step,
  scriptStep: job.steps.find((s) => s.uses?.startsWith('actions/github-script@')) as Step,
});

const APP_JOBS = ['create-version-tag', 'tag-major-minor'];
const releasePleaseStep = (job: Job) =>
  job.steps.find((s) => s.uses?.startsWith('googleapis/release-please-action@')) as Step;
const versionJob = workflow.jobs['create-version-tag'];
const tagJob = workflow.jobs['tag-major-minor'];
const versionScriptStep = appSteps(versionJob).scriptStep;
const checkJob = workflow.jobs['check-version-tag'];
const checkScriptStep = checkJob.steps.find((s) => s.uses?.startsWith('actions/github-script@')) as Step;
const scriptStep = appSteps(tagJob).scriptStep;

const RELEASE = 'c'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const OLDER = 'a'.repeat(40);
const NEWER = 'e'.repeat(40);
const OTHER = 'd'.repeat(40);
// The commit that triggered the run. In a recovery run this is a later commit
// on main, not the release commit, so the script must never use it.
const TRIGGER = 'f'.repeat(40);

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const squash = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim();

describe('Release workflow: jobs that gate the floating tags', () => {
  // A failed security gate or attestation must stop the tags moving. A job or
  // step marked continue-on-error reports success to the jobs after it even
  // when it fails, and a step with an `if:` can be skipped.
  test.each(['create-version-tag', 'security-gate', 'attest', 'tag-major-minor'])(
    'the %s job and its steps cannot be skipped or have their failures ignored',
    (name) => {
      const job = workflow.jobs[name];
      expect(job).not.toHaveProperty('continue-on-error');
      for (const step of job.steps) {
        expect(step).not.toHaveProperty('continue-on-error');
        expect(step).not.toHaveProperty('if');
      }
    },
  );

  test('the security gate action steps cannot be skipped or have their failures ignored', () => {
    for (const step of securityGateAction.runs.steps) {
      expect(step).not.toHaveProperty('continue-on-error');
      expect(step).not.toHaveProperty('if');
    }
  });

  test('the version tag is created straight after release-please, only when a release was created', () => {
    expect([versionJob.needs].flat()).toEqual(['release-please']);
    expect(versionJob.if).toBe("${{ needs.release-please.outputs.release_created == 'true' }}");
  });

  test('the tag job waits for the version tag, the security gate and the attestation, and only runs when they succeed', () => {
    expect(tagJob.needs).toEqual(
      expect.arrayContaining(['release-please', 'create-version-tag', 'security-gate', 'attest']),
    );
    // No always() or other status function: the implicit success() is what
    // stops the tags moving after a failed gate or attestation.
    expect(tagJob.if).toBe("${{ needs.release-please.outputs.release_created == 'true' }}");
  });

  test('publishing requires the version tag, the security gate, the attestation and the tag job to succeed', () => {
    const publish = workflow.jobs['publish-release'];
    expect(publish.needs).toEqual(
      expect.arrayContaining(['create-version-tag', 'security-gate', 'attest', 'tag-major-minor']),
    );
    expect(squash(publish.if)).toBe(
      squash(`\${{ always() &&
        needs.release-please.outputs.release_created == 'true' &&
        needs.create-version-tag.result == 'success' &&
        needs.security-gate.result == 'success' &&
        needs.attest.result == 'success' &&
        needs.tag-major-minor.result == 'success' }}`),
    );
  });
});

describe('Release workflow: release-please does not create tags', () => {
  // The version-tag-creation ruleset rejects GITHUB_TOKEN, and release-please
  // ignores a rejected tag creation, so it must not try.
  test('force-tag-creation is off', () => {
    expect(releasePleaseConfig.packages['.']['force-tag-creation']).toBe(false);
  });

  test.each(['release-please', 'release-pr'])(
    'the %s job runs release-please on GITHUB_TOKEN, outside the release environment',
    (name) => {
      const job = workflow.jobs[name];
      expect(job.environment).toBeUndefined();
      expect(job.steps).toHaveLength(1);
      expect(releasePleaseStep(job).with?.token).toBe('${{ secrets.GITHUB_TOKEN }}');
    },
  );
});

describe('Release workflow: the release PR is updated only after the version tag exists', () => {
  // release-please finds the previous release by its tag. Run in the same step
  // as the release, before the tag exists, it would propose a bogus version.
  const releaseJob = workflow.jobs['release-please'];
  const prJob = workflow.jobs['release-pr'];
  const releaseStep = releasePleaseStep(releaseJob);
  const prStep = releasePleaseStep(prJob);

  test('the release-please job creates the release but not the release PR', () => {
    expect(releaseStep.with?.['skip-github-pull-request']).toBe(true);
    expect(releaseStep.with).not.toHaveProperty('skip-github-release');
  });

  test('the release-pr job updates the release PR but creates no release', () => {
    expect(prStep.with?.['skip-github-release']).toBe(true);
    expect(prStep.with).not.toHaveProperty('skip-github-pull-request');
  });

  test('both runs use the same configuration and the same pinned action', () => {
    const { 'skip-github-pull-request': _a, ...releaseWith } = releaseStep.with ?? {};
    const { 'skip-github-release': _b, ...prWith } = prStep.with ?? {};
    expect(prWith).toEqual(releaseWith);
    expect(prStep.uses).toBe(releaseStep.uses);
  });

  test('the check-version-tag job only reads, with a single github-script step on GITHUB_TOKEN', () => {
    expect(checkJob.permissions).toEqual({ contents: 'read' });
    expect(checkJob.environment).toBeUndefined();
    expect(checkJob).not.toHaveProperty('continue-on-error');
    expect(checkJob.steps).toEqual([checkScriptStep]);
    expect(checkScriptStep.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
    // Runs on this job's GITHUB_TOKEN, not the App token.
    expect(checkScriptStep.with).not.toHaveProperty('github-token');
    expect(checkScriptStep).not.toHaveProperty('env');
    expect(checkScriptStep).not.toHaveProperty('continue-on-error');
    expect(checkScriptStep).not.toHaveProperty('if');
    expect(checkJob.outputs).toEqual({ current: `\${{ steps.${checkScriptStep.id}.outputs.current }}` });
  });

  test('the release-pr job runs only when the check passed and this run is for the head of the branch', () => {
    expect([prJob.needs].flat()).toEqual(['check-version-tag']);
    // !cancelled(), not the implicit success(): success() also requires
    // create-version-tag, which is skipped on every push that is not a
    // release, to have succeeded, so the release PR would never be updated
    // between releases.
    expect(squash(prJob.if)).toBe(
      squash(`\${{ !cancelled() &&
          needs.check-version-tag.result == 'success' &&
          needs.check-version-tag.outputs.current == 'true' }}`),
    );
    expect(prJob).not.toHaveProperty('continue-on-error');
  });

  test('the check-version-tag job waits for the version tag and runs only if it was created or not needed', () => {
    expect(checkJob.needs).toEqual(['release-please', 'create-version-tag']);
    // !cancelled(), not always(): a cancelled run must not update the release PR.
    expect(squash(checkJob.if)).toBe(
      squash(`\${{ !cancelled() &&
          needs.release-please.result == 'success' &&
          (needs.create-version-tag.result == 'success' ||
           needs.create-version-tag.result == 'skipped') }}`),
    );
  });
});

describe.each(APP_JOBS)('Release workflow: %s job definition', (name) => {
  const job = workflow.jobs[name];
  const { tokenStep, scriptStep: step } = appSteps(job);

  test('uses the main-only release environment', () => {
    expect(job.environment).toBe('release');
  });

  test('grants GITHUB_TOKEN nothing', () => {
    expect(job.permissions).toEqual({});
  });

  test('has only the token step and the script step', () => {
    expect(job.steps).toEqual([tokenStep, step]);
  });

  test('mints an app token with contents: write only, for this repository only, revoked at the end', () => {
    expect(tokenStep.uses).toMatch(/^actions\/create-github-app-token@[0-9a-f]{40}$/);
    expect(tokenStep.with).toMatchObject({
      'client-id': '${{ vars.RELEASE_APP_CLIENT_ID }}',
      'private-key': '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
    });
    const permissions = Object.entries(tokenStep.with ?? {}).filter(([key]) => key.startsWith('permission-'));
    expect(permissions).toEqual([['permission-contents', 'write']]);
    expect(tokenStep.with).not.toHaveProperty('owner');
    expect(tokenStep.with).not.toHaveProperty('repositories');
    expect(tokenStep.with).not.toHaveProperty('skip-token-revoke');
  });

  test('passes the app token to the script step', () => {
    expect(step.with?.['github-token']).toBe('${{ steps.app-token.outputs.token }}');
  });
});

describe('Release workflow: App credentials', () => {
  test('only the two tag jobs use the release environment', () => {
    const users = Object.entries(workflow.jobs)
      .filter(([, job]) => job.environment)
      .map(([name]) => name);
    expect(users).toEqual(APP_JOBS);
  });

  test('the App token and key are referenced only by the two tag jobs', () => {
    expect(workflowText.match(/steps\.app-token\.outputs\.token/g)).toHaveLength(APP_JOBS.length);
    expect(workflowText.match(/secrets\.RELEASE_APP_PRIVATE_KEY/g)).toHaveLength(APP_JOBS.length);
  });

  test('gives the version tag script the release-please outputs', () => {
    expect(versionScriptStep.env).toEqual({
      RELEASE_SHA: '${{ needs.release-please.outputs.sha }}',
      TAG_NAME: '${{ needs.release-please.outputs.tag_name }}',
      APP_SLUG: '${{ steps.app-token.outputs.app-slug }}',
    });
  });

  test('gives the floating tag script the release-please outputs', () => {
    expect(scriptStep.env).toEqual({
      RELEASE_SHA: '${{ needs.release-please.outputs.sha }}',
      TAG_NAME: '${{ needs.release-please.outputs.tag_name }}',
      MAJOR_TAG: 'v${{ needs.release-please.outputs.major }}',
      MINOR_TAG: 'v${{ needs.release-please.outputs.major }}.${{ needs.release-please.outputs.minor }}',
      APP_SLUG: '${{ steps.app-token.outputs.app-slug }}',
    });
  });
});

// getRef, createRef and updateRef failures are keyed by tag name; compare
// failures are keyed by the tag's current commit (the comparison's base).
// An Error that is not an HttpError has no status, as with a network failure.
type Failures = {
  getRef?: Record<string, Error>;
  createRef?: Record<string, Error>;
  updateRef?: Record<string, Error>;
  compare?: Record<string, Error>;
};

// A small model of a repository: tag refs and a linear history in which each
// commit's parent is the previous entry. OTHER is not in the history, so it
// has diverged from everything. A tag value of { annotated: true } is an
// annotated tag.
function fakeGitHub(tags: Record<string, string | { annotated: true }>, failures: Failures = {}) {
  const history = [OLDER, PREVIOUS, RELEASE, NEWER];
  const writes: string[] = [];
  const fail = (table: Record<string, Error> | undefined, key: string) => {
    if (table?.[key]) throw table[key];
  };

  const git = {
    getRef: jest.fn(async ({ ref }: { ref: string }) => {
      const name = ref.replace(/^tags\//, '');
      fail(failures.getRef, name);
      if (!(name in tags)) throw new HttpError(404, 'Not Found');
      const value = tags[name];
      return typeof value === 'string'
        ? { data: { object: { sha: value, type: 'commit' } } }
        : { data: { object: { sha: OTHER, type: 'tag' } } };
    }),
    createRef: jest.fn(async ({ ref, sha }: { ref: string; sha: string }) => {
      const name = ref.replace(/^refs\/tags\//, '');
      fail(failures.createRef, name);
      tags[name] = sha;
      writes.push(`create ${name}`);
    }),
    updateRef: jest.fn(async ({ ref, sha }: { ref: string; sha: string; force: boolean }) => {
      const name = ref.replace(/^tags\//, '');
      fail(failures.updateRef, name);
      tags[name] = sha;
      writes.push(`update ${name}`);
    }),
  };

  const repos = {
    compareCommitsWithBasehead: jest.fn(async ({ basehead }: { basehead: string; per_page: number }) => {
      const [base, head] = basehead.split('...');
      fail(failures.compare, base);
      const b = history.indexOf(base);
      const h = history.indexOf(head);
      let status = 'diverged';
      if (b !== -1 && h !== -1) status = b === h ? 'identical' : h > b ? 'ahead' : 'behind';
      return { data: { status } };
    }),
  };

  return { github: { rest: { git, repos } }, tags, writes };
}

// Runs the script the way actions/github-script v9 does: as the body of an
// async function with these ten parameters, so a script that redeclares one of
// them fails here too.
async function runScript(github: unknown, env: Record<string, string> = {}, script = scriptStep.with?.script) {
  const core = { info: jest.fn(), setOutput: jest.fn() };
  const context = {
    repo: { owner: 'BeyondTrust', repo: 'workload-credentials-action' },
    sha: TRIGGER,
    payload: { repository: { default_branch: 'main' } },
  };
  const saved = { ...process.env };
  Object.assign(process.env, {
    RELEASE_SHA: RELEASE,
    TAG_NAME: 'v1.2.0',
    MAJOR_TAG: 'v1',
    MINOR_TAG: 'v1.2',
    APP_SLUG: 'bt-workload-credentials-tagger',
    GITHUB_SHA: TRIGGER,
    ...env,
  });
  // Built from a string so the TypeScript compiler cannot down-level it: the
  // compiled form of `async () => {}` may not be a real async function.
  const AsyncFunction = new Function('return Object.getPrototypeOf(async function () {}).constructor')();
  const names = [
    'require',
    '__original_require__',
    'github',
    'octokit',
    'getOctokit',
    'context',
    'core',
    'exec',
    'glob',
    'io',
  ];
  try {
    const fn = new AsyncFunction(...names, script);
    await fn(require, require, github, github, undefined, context, core, undefined, undefined, undefined);
    return { core, error: undefined as Error | undefined };
  } catch (error) {
    return { core, error: error as Error };
  } finally {
    process.env = saved;
  }
}

describe('Release workflow: check-version-tag script', () => {
  // The manifest at the commit that triggered the run, as the contents API
  // returns it.
  const manifest = (version: unknown) => ({
    data: { content: Buffer.from(JSON.stringify({ '.': version })).toString('base64') },
  });

  // `head` is the commit main points at now; by default the commit that
  // triggered the run. `failures` makes a lookup throw: `branch` for the
  // branch head, `tag` for any tag.
  function fakeCheckGitHub(
    tags: string[],
    {
      content = manifest('1.2.0') as { data: { content: string } } | Error,
      head = TRIGGER,
      failures = {} as { branch?: Error; tag?: Error },
    } = {},
  ) {
    const git = {
      getRef: jest.fn(async ({ ref }: { ref: string }) => {
        if (ref.startsWith('heads/')) {
          if (failures.branch) throw failures.branch;
          if (ref !== 'heads/main') throw new HttpError(404, 'Not Found');
          return { data: { object: { sha: head, type: 'commit' } } };
        }
        if (failures.tag) throw failures.tag;
        if (!tags.includes(ref.replace(/^tags\//, ''))) throw new HttpError(404, 'Not Found');
        return { data: { object: { sha: RELEASE, type: 'commit' } } };
      }),
      createRef: jest.fn(),
      updateRef: jest.fn(),
    };
    const repos = {
      getContent: jest.fn(async () => {
        if (content instanceof Error) throw content;
        return content;
      }),
    };
    return { rest: { git, repos } };
  }

  const runCheck = (github: unknown) => runScript(github, {}, checkScriptStep.with?.script);
  const tagLookups = (github: ReturnType<typeof fakeCheckGitHub>) =>
    github.rest.git.getRef.mock.calls.filter(([{ ref }]) => ref.startsWith('tags/'));

  test('passes and sets current=true when the tag for the manifest version exists', async () => {
    const github = fakeCheckGitHub(['v1.2.0']);
    const { error, core } = await runCheck(github);

    expect(error).toBeUndefined();
    expect(core.info).toHaveBeenCalledWith('Version tag v1.2.0 exists');
    expect(core.setOutput).toHaveBeenCalledWith('current', 'true');
    expect(github.rest.git.getRef).toHaveBeenCalledWith(expect.objectContaining({ ref: 'heads/main' }));
    expect(github.rest.git.getRef).toHaveBeenCalledWith(expect.objectContaining({ ref: 'tags/v1.2.0' }));
  });

  test('reads the manifest at the commit that triggered the run', async () => {
    const github = fakeCheckGitHub(['v1.2.0']);
    await runCheck(github);

    expect(github.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: '.release-please-manifest.json', ref: TRIGGER }),
    );
  });

  test('sets current=false, without failing, when the branch has moved past the triggering commit', async () => {
    // The release PR was merged while this run was in progress: release-please
    // would read the new manifest, whose tag the newer run has not created yet.
    const github = fakeCheckGitHub([], { head: NEWER, content: manifest('1.3.0') });
    const { error, core } = await runCheck(github);

    expect(error).toBeUndefined();
    expect(core.setOutput).toHaveBeenCalledWith('current', 'false');
    expect(core.setOutput).not.toHaveBeenCalledWith('current', 'true');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining(`main has moved from ${TRIGGER} to ${NEWER}`));
    expect(github.rest.repos.getContent).not.toHaveBeenCalled();
    expect(tagLookups(github)).toHaveLength(0);
  });

  test('fails when the push event has no default branch', async () => {
    const github = fakeCheckGitHub(['v1.2.0']);
    const script = `context.payload = {};\n${checkScriptStep.with?.script}`;
    const { error, core } = await runScript(github, {}, script);

    expect(error?.message).toContain('The push event has no default branch');
    expect(github.rest.git.getRef).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  test('fails when the branch head cannot be looked up', async () => {
    const github = fakeCheckGitHub(['v1.2.0'], { failures: { branch: new HttpError(502, 'Bad Gateway') } });
    const { error, core } = await runCheck(github);

    expect(error?.message).toContain('Looking up the head of main failed (HTTP 502)');
    expect(error?.message).toContain('Bad Gateway');
    expect(github.rest.repos.getContent).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  test('fails, pointing at the recovery steps, when the tag does not exist', async () => {
    const github = fakeCheckGitHub(['v1.1.0']);
    const { error, core } = await runCheck(github);

    expect(error?.message).toContain('Version tag v1.2.0 does not exist');
    // Names every cause, not only a failed create-version-tag job.
    expect(error?.message).toContain('create-version-tag failed, or the run was cancelled');
    expect(error?.message).toContain('no release was created for 1.2.0');
    expect(error?.message).toContain('"autorelease: pending" label');
    expect(error?.message).toContain('See "Recovering a stalled release"');
    expect(error?.message).toContain('The release PR was not updated.');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  test('fails when the tag lookup fails', async () => {
    const github = fakeCheckGitHub(['v1.2.0'], { failures: { tag: new HttpError(500, 'Server Error') } });
    const { error, core } = await runCheck(github);

    expect(error?.message).toContain('Looking up tag v1.2.0 failed (HTTP 500)');
    expect(error?.message).toContain('Server Error');
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  test.each([
    ['the branch head', { branch: new Error('getaddrinfo ENOTFOUND api.github.com') }],
    ['the tag', { tag: new Error('getaddrinfo ENOTFOUND api.github.com') }],
  ])('reports a lookup of %s that fails without an HTTP status, without "HTTP undefined"', async (_, failures) => {
    const github = fakeCheckGitHub(['v1.2.0'], { failures });
    const { error } = await runCheck(github);

    expect(error?.message).toContain('failed. The release PR was not updated.');
    expect(error?.message).toContain('ENOTFOUND');
    expect(error?.message).not.toContain('HTTP');
  });

  test('fails when the manifest cannot be read', async () => {
    const github = fakeCheckGitHub(['v1.2.0'], { content: new HttpError(404, 'Not Found') });
    const { error } = await runCheck(github);

    expect(error?.message).toContain(`Reading .release-please-manifest.json at ${TRIGGER} failed (HTTP 404)`);
    expect(tagLookups(github)).toHaveLength(0);
  });

  test('fails when the manifest is not JSON', async () => {
    const github = fakeCheckGitHub(['v1.2.0'], { content: { data: { content: Buffer.from('{').toString('base64') } } });
    const { error } = await runCheck(github);

    expect(error?.message).toContain(`Reading .release-please-manifest.json at ${TRIGGER} failed. `);
    expect(tagLookups(github)).toHaveLength(0);
  });

  test.each([undefined, 1.2, '', '1.2', 'v1.2.0', '1.2.0-rc.1', '1.2.0\n'])(
    'refuses manifest version %p before looking up any tag',
    async (version) => {
      const github = fakeCheckGitHub(['v1.2.0'], { content: manifest(version) });
      const { error } = await runCheck(github);

      expect(error?.message).toContain('Unexpected version');
      expect(tagLookups(github)).toHaveLength(0);
    },
  );

  test('writes nothing', async () => {
    const github = fakeCheckGitHub(['v1.2.0']);
    await runCheck(github);

    expect(github.rest.git.createRef).not.toHaveBeenCalled();
    expect(github.rest.git.updateRef).not.toHaveBeenCalled();
  });
});

describe('Release workflow: version tag script', () => {
  const runVersion = (github: unknown, env: Record<string, string> = {}) =>
    runScript(github, env, versionScriptStep.with?.script);

  test('creates the version tag at the release commit', async () => {
    const fake = fakeGitHub({ v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error, core } = await runVersion(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual(['create v1.2.0']);
    expect(fake.github.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/tags/v1.2.0', sha: RELEASE }),
    );
    expect(core.info).toHaveBeenCalledWith(`Created version tag v1.2.0 at ${RELEASE}`);
  });

  test('accepts a version tag that already points at the release commit, as in a recovery run', async () => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE });
    const { error, core } = await runVersion(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual([]);
    expect(core.info).toHaveBeenCalledWith(`Version tag v1.2.0 already at ${RELEASE}`);
  });

  test('refuses a version tag that points at another commit, and changes nothing', async () => {
    const fake = fakeGitHub({ 'v1.2.0': OTHER });
    const { error } = await runVersion(fake.github);

    expect(error?.message).toContain(`Version tag v1.2.0 already exists and points at commit ${OTHER}`);
    expect(error?.message).toContain('Find out who created v1.2.0');
    expect(fake.writes).toEqual([]);
  });

  test('refuses an annotated version tag, and changes nothing', async () => {
    const fake = fakeGitHub({ 'v1.2.0': { annotated: true } });
    const { error } = await runVersion(fake.github);

    expect(error?.message).toContain(`Version tag v1.2.0 already exists and points at tag ${OTHER}`);
    expect(fake.writes).toEqual([]);
  });

  test.each([
    ['RELEASE_SHA', ''],
    ['RELEASE_SHA', 'abc123'],
    ['TAG_NAME', ''],
    ['TAG_NAME', 'v1.2'],
    ['TAG_NAME', 'v1.2.0-rc.1'],
    ['TAG_NAME', 'v1.2.0/x'],
  ])('refuses %s "%s" before making any request', async (name, value) => {
    const fake = fakeGitHub({});
    const { error } = await runVersion(fake.github, { [name]: value });

    expect(error?.message).toContain('from release-please. No tag was created.');
    expect(fake.github.rest.git.getRef).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  test('fails, writing nothing, when the lookup fails', async () => {
    const fake = fakeGitHub({}, { getRef: { 'v1.2.0': new HttpError(500, 'Server Error') } });
    const { error } = await runVersion(fake.github);

    expect(error?.message).toContain('Looking up tag v1.2.0 failed (HTTP 500)');
    expect(fake.writes).toEqual([]);
  });

  test.each([
    ['a ruleset refusal', new HttpError(422, 'Repository rule violations found'), true],
    ['a tag created since the lookup', new HttpError(422, 'Reference already exists'), false],
  ])('fails when creating the tag hits %s', async (_, rejection, ruleset) => {
    const fake = fakeGitHub({}, { createRef: { 'v1.2.0': rejection } });
    const { error } = await runVersion(fake.github);

    expect(error?.message).toContain(`Creating version tag v1.2.0 at ${RELEASE} failed (HTTP 422)`);
    expect(error?.message.includes('bypass actor on the version-tag-creation ruleset')).toBe(ruleset);
    expect(error?.message).toContain(rejection.message);
  });

  test.each([
    ['looking up', 'getRef', 'Looking up tag v1.2.0 failed. Details: '],
    ['creating', 'createRef', `Creating version tag v1.2.0 at ${RELEASE} failed. Details: `],
  ] as const)(
    'reports a failure %s the tag without an HTTP status, without "HTTP undefined"',
    async (_, call, text) => {
      const fake = fakeGitHub({}, { [call]: { 'v1.2.0': new Error('getaddrinfo ENOTFOUND api.github.com') } });
      const { error } = await runVersion(fake.github);

      expect(error?.message).toContain(`${text}getaddrinfo ENOTFOUND`);
      expect(error?.message).not.toContain('HTTP');
    },
  );
});

describe('Release workflow: tag script, normal releases', () => {
  test('patch release: moves both tags forward to the release commit, minor tag first, without force', async () => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error, core } = await runScript(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual(['update v1.2', 'update v1']);
    expect(fake.tags).toMatchObject({ v1: RELEASE, 'v1.2': RELEASE });
    for (const [args] of fake.github.rest.git.updateRef.mock.calls) {
      expect(args).toMatchObject({ sha: RELEASE, force: false });
    }
    for (const [args] of fake.github.rest.repos.compareCommitsWithBasehead.mock.calls) {
      expect(args).toMatchObject({ basehead: `${PREVIOUS}...${RELEASE}`, per_page: 1 });
    }
    expect(core.info).toHaveBeenCalledWith(`Moving tag v1 from ${PREVIOUS} to ${RELEASE} (v1.2.0): done`);
  });

  test('first release on a new minor line: creates the minor tag at the release commit', async () => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS });
    const { error } = await runScript(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual(['create v1.2', 'update v1']);
    expect(fake.github.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/tags/v1.2', sha: RELEASE }),
    );
    expect(fake.tags).toMatchObject({ v1: RELEASE, 'v1.2': RELEASE });
  });

  test('first release on a new major line: creates both tags at the release commit', async () => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE });
    const { error } = await runScript(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual(['create v1.2', 'create v1']);
    expect(fake.tags).toMatchObject({ v1: RELEASE, 'v1.2': RELEASE });
    expect(fake.github.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  test('leaves a tag that already points at the release commit alone', async () => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: RELEASE, 'v1.2': PREVIOUS });
    const { error, core } = await runScript(fake.github);

    expect(error).toBeUndefined();
    expect(fake.writes).toEqual(['update v1.2']);
    expect(core.info).toHaveBeenCalledWith(`Tag v1 already at ${RELEASE} (v1.2.0)`);
  });
});

describe('Release workflow: tag script, release-please outputs', () => {
  // A refused output must stop the script before it makes any request.
  const noRequests = (fake: ReturnType<typeof fakeGitHub>) => {
    expect(fake.github.rest.git.getRef).not.toHaveBeenCalled();
    expect(fake.github.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  };

  test.each([
    ['RELEASE_SHA', ''],
    ['RELEASE_SHA', 'abc123'],
    ['RELEASE_SHA', RELEASE.toUpperCase()],
    ['TAG_NAME', ''],
    ['TAG_NAME', 'v1.2'],
    ['TAG_NAME', 'v1.2.0-rc.1'],
    ['TAG_NAME', '1.2.0'],
    ['MAJOR_TAG', 'v'],
    ['MAJOR_TAG', 'v1.2'],
    ['MINOR_TAG', 'v.'],
    ['MINOR_TAG', 'v1'],
    ['MINOR_TAG', 'v1.2/x'],
  ])('refuses %s "%s" before making any request', async (name, value) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error } = await runScript(fake.github, { [name]: value });

    expect(error?.message).toContain(`Unexpected ${name} "${value}" from release-please`);
    expect(error?.message).toContain('No tag was changed.');
    noRequests(fake);
  });

  test.each([
    ['a version on another minor line', { TAG_NAME: 'v1.3.0' }],
    ['a minor tag on another major line', { MINOR_TAG: 'v2.2', TAG_NAME: 'v2.2.0' }],
    ['a minor tag that only shares a prefix', { MINOR_TAG: 'v12.2', TAG_NAME: 'v12.2.0' }],
    ['a version whose minor number only starts with the minor tag', { TAG_NAME: 'v1.20.0' }],
  ])('refuses %s before making any request', async (_, env) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error } = await runScript(fake.github, env);

    expect(error?.message).toContain('do not describe the same version. No tag was changed.');
    noRequests(fake);
  });
});

describe('Release workflow: tag script, refusals', () => {
  // Each refusal is tested on both tags, so neither tag can skip a check.
  test.each([
    ['v1', 'behind', NEWER],
    ['v1.2', 'behind', NEWER],
    ['v1', 'diverged', OTHER],
    ['v1.2', 'diverged', OTHER],
  ])('refuses to move %s when it is %s the release commit, and changes nothing', async (tag, status, commit) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS, [tag]: commit });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Not moving ${tag}: the release commit ${RELEASE} (v1.2.0) is not ahead`);
    expect(error?.message).toContain(`compare status: ${status}`);
    expect(fake.writes).toEqual([]);
  });

  test.each(['v1', 'v1.2'])('refuses an annotated %s tag and changes nothing', async (tag) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS, [tag]: { annotated: true } });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Tag ${tag} is an annotated tag`);
    expect(error?.message).toContain(`Find out who created ${tag}`);
    expect(error?.message).not.toContain('re-run');
    expect(fake.writes).toEqual([]);
  });

  test('refuses when the version tag points at another commit, before looking at the floating tags', async () => {
    const fake = fakeGitHub({ 'v1.2.0': OTHER, v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Version tag v1.2.0 points at ${OTHER}, not the release commit ${RELEASE}`);
    expect(error?.message).toContain('Find out who created v1.2.0');
    expect(fake.github.rest.git.getRef).toHaveBeenCalledTimes(1);
    expect(fake.writes).toEqual([]);
  });

  test('refuses when the version tag does not exist, before looking at the floating tags', async () => {
    const fake = fakeGitHub({ v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain('Version tag v1.2.0 does not exist');
    expect(error?.message).toContain(
      "The create-version-tag job creates it before this job runs; check that job's log.",
    );
    expect(fake.github.rest.git.getRef).toHaveBeenCalledTimes(1);
    expect(fake.writes).toEqual([]);
  });

  test('refuses an annotated version tag and changes nothing', async () => {
    const fake = fakeGitHub({ 'v1.2.0': { annotated: true }, v1: PREVIOUS, 'v1.2': PREVIOUS });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain('Tag v1.2.0 is an annotated tag');
    expect(fake.writes).toEqual([]);
  });
});

describe('Release workflow: tag script, failed requests', () => {
  test('fails, writing nothing, when the version tag lookup fails', async () => {
    const fake = fakeGitHub(
      { 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS },
      { getRef: { 'v1.2.0': new HttpError(500, 'Server Error') } },
    );
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain('Looking up tag v1.2.0 failed (HTTP 500)');
    expect(fake.writes).toEqual([]);
  });

  test.each(['v1', 'v1.2'])('fails, writing nothing, when the %s lookup fails', async (tag) => {
    const fake = fakeGitHub(
      { 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS },
      { getRef: { [tag]: new HttpError(403, 'Resource not accessible by integration') } },
    );
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Looking up tag ${tag} failed (HTTP 403)`);
    expect(error?.message).toContain('Resource not accessible by integration');
    expect(fake.writes).toEqual([]);
  });

  test.each([
    ['v1', OLDER],
    ['v1.2', PREVIOUS],
  ])('fails, writing nothing, when the comparison for %s fails', async (tag, commit) => {
    const fake = fakeGitHub(
      { 'v1.2.0': RELEASE, v1: OLDER, 'v1.2': PREVIOUS },
      { compare: { [commit]: new HttpError(502, 'Bad Gateway') } },
    );
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Comparing ${tag} (${commit}) with ${RELEASE} failed (HTTP 502)`);
    expect(fake.writes).toEqual([]);
  });

  test('names the app when a ruleset rejects a move, and leaves the major tag untouched', async () => {
    const rejection = new HttpError(422, 'Repository rule violations found\n\nCannot update this protected ref.');
    const fake = fakeGitHub(
      { 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS },
      { updateRef: { 'v1.2': rejection } },
    );
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Moving tag v1.2 from ${PREVIOUS} to ${RELEASE} failed (HTTP 422)`);
    expect(error?.message).toContain('the bt-workload-credentials-tagger app is a bypass actor');
    expect(error?.message).toContain('Cannot update this protected ref.');
    expect(fake.tags.v1).toBe(PREVIOUS);
  });

  test.each([
    ['a ruleset refusal', new HttpError(422, 'Repository rule violations found'), true],
    ['an existing tag', new HttpError(422, 'Reference already exists'), false],
  ])('fails, leaving the major tag untouched, when creating the minor tag hits %s', async (_, rejection, ruleset) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS }, { createRef: { 'v1.2': rejection } });
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Creating tag v1.2 at ${RELEASE} failed (HTTP 422)`);
    expect(error?.message.includes('bypass actor')).toBe(ruleset);
    expect(fake.writes).toEqual([]);
    expect(fake.tags.v1).toBe(PREVIOUS);
  });

  test('reports which tag failed when the major tag write fails after the minor tag moved', async () => {
    const fake = fakeGitHub(
      { 'v1.2.0': RELEASE, v1: PREVIOUS },
      { updateRef: { v1: new HttpError(500, 'Server Error') } },
    );
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`Moving tag v1 from ${PREVIOUS} to ${RELEASE} failed (HTTP 500)`);
    expect(error?.message).not.toContain('bypass actor');
    expect(fake.writes).toEqual(['create v1.2']);
  });

  test.each([
    ['a lookup', { getRef: { v1: new Error('socket hang up') } }, 'Looking up tag v1 failed. Details: '],
    [
      'a comparison',
      { compare: { [PREVIOUS]: new Error('socket hang up') } },
      `Comparing v1.2 (${PREVIOUS}) with ${RELEASE} failed. Details: `,
    ],
    [
      'a move',
      { updateRef: { 'v1.2': new Error('socket hang up') } },
      `Moving tag v1.2 from ${PREVIOUS} to ${RELEASE} failed. Details: `,
    ],
  ])('reports %s that fails without an HTTP status, without "HTTP undefined"', async (_, failures, text) => {
    const fake = fakeGitHub({ 'v1.2.0': RELEASE, v1: PREVIOUS, 'v1.2': PREVIOUS }, failures);
    const { error } = await runScript(fake.github);

    expect(error?.message).toContain(`${text}socket hang up`);
    expect(error?.message).not.toContain('HTTP');
  });
});
