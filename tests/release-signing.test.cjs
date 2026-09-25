/**
 * Windows releases without the PC: the release target and the eSigner hook.
 *
 * SSL.com rejects a reused one-time code, and repeated rejections can lock the
 * credential, so the hook must never sign twice inside one 30 s TOTP step.
 * The release-target script must change nothing until RELEASES_REPO is set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const { configure } = require('../scripts/configure-release-target.js');
const builderYml = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');

test('without RELEASES_REPO, WIN_PUBLISHER_NAMES or eSigner mode the build config is untouched', () => {
  assert.equal(configure({}, builderYml), null);
});

test('RELEASES_REPO moves the update feed; everything else stays', () => {
  const config = yaml.load(configure({ RELEASES_REPO: 'EVIA-Production/taylos-releases' }, builderYml));
  assert.deepEqual(config.publish, { provider: 'github', owner: 'EVIA-Production', repo: 'taylos-releases' });
  const original = yaml.load(builderYml);
  assert.deepEqual(config.win.signtoolOptions, original.win.signtoolOptions);
  assert.equal(config.afterSign, original.afterSign);
  assert.throws(() => configure({ RELEASES_REPO: 'taylos-releases' }, builderYml), /owner\/repo/);
  assert.throws(() => configure({ RELEASES_REPO: 'a/b/c' }, builderYml), /owner\/repo/);
});

test('the bridge accepts the old and the new Windows certificate', () => {
  const config = yaml.load(configure({ WIN_PUBLISHER_NAMES: 'Benedict Kroetz, Akaska UG (haftungsbeschränkt)' }, builderYml));
  assert.deepEqual(config.win.signtoolOptions.publisherName, ['Benedict Kroetz', 'Akaska UG (haftungsbeschränkt)']);
});

test('eSigner mode drops the Certum thumbprint, which is not in a hosted runner\'s store', () => {
  const config = yaml.load(configure({ WIN_SIGN_MODE: 'esigner' }, builderYml));
  assert.equal(config.win.signtoolOptions.certificateSha1, undefined);
  assert.equal(config.win.signtoolOptions.sign, './scripts/sign-windows-serial.js');
});

function withFakeClock(startMs, fn) {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  let now = startMs;
  const waits = [];
  Date.now = () => now;
  global.setTimeout = (callback, ms) => { waits.push(ms); now += ms; callback(); return 0; };
  return Promise.resolve()
    .then(() => fn(() => now))
    .finally(() => { Date.now = realNow; global.setTimeout = realSetTimeout; })
    .then((result) => ({ result, waits, end: now }));
}

test('the eSigner hook never uses one TOTP step twice', async () => {
  const esigner = require('../scripts/sign-windows-esigner.js');
  esigner._reset();
  const step = 30_000;
  const steps = [];
  await withFakeClock(1_000 * step + 2_000, async (clock) => {
    for (let i = 0; i < 4; i += 1) {
      await esigner._waitForFreshStep();
      steps.push(Math.floor(clock() / step));
    }
  });
  assert.equal(new Set(steps).size, steps.length, `steps reused: ${steps}`);
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] > steps[i - 1]);
});

test('a code is never used in the last seconds of its step', async () => {
  const esigner = require('../scripts/sign-windows-esigner.js');
  esigner._reset();
  const step = 30_000;
  const { end } = await withFakeClock(2_000 * step + 27_000, () => esigner._waitForFreshStep());
  assert.ok(end % step < 25_000, `signed ${end % step} ms into a step`);
});

test('jsign is called with the eSigner store, an RFC 3161 timestamp and replace', () => {
  const esigner = require('../scripts/sign-windows-esigner.js');
  const saved = { ...process.env };
  Object.assign(process.env, {
    JSIGN_JAR: '/tmp/jsign.jar', ESIGNER_USERNAME: 'user', ESIGNER_PASSWORD: 'pass',
    ESIGNER_TOTP_SECRET: 'SECRET', ESIGNER_CREDENTIAL_ID: 'cred-1',
  });
  try {
    const args = esigner._jsignArgs('C:\\dist\\Taylos.exe');
    const value = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(value('--storetype'), 'ESIGNER');
    assert.equal(value('--storepass'), 'user|pass');
    assert.equal(value('--keypass'), 'SECRET');
    assert.equal(value('--alias'), 'cred-1');
    assert.equal(value('--tsmode'), 'RFC3161');
    assert.ok(args.includes('--replace'));
    assert.equal(args[args.length - 1], 'C:\\dist\\Taylos.exe');
    delete process.env.ESIGNER_TOTP_SECRET;
    assert.throws(() => esigner._jsignArgs('x'), /ESIGNER_TOTP_SECRET is required/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('the signing hook hands eSigner mode to the cloud signer and keeps signtool otherwise', () => {
  const serial = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sign-windows-serial.js'), 'utf8');
  assert.match(serial, /process\.env\.WIN_SIGN_MODE === 'esigner'[\s\S]{0,120}require\('\.\/sign-windows-esigner'\)/);
  assert.match(serial, /signingQueue\.then\(\(\) => signOne\(configuration\)\)/, 'the PC path is unchanged');
});

test('the cloud workflow pins jsign, verifies every signature, and signs one run at a time', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-windows-cloud.yml'), 'utf8'));
  const job = workflow.jobs['build-sign-verify'];
  assert.equal(job['runs-on'], 'windows-latest');
  // Job level: a workflow-level group is not reliable when a tag release calls this workflow.
  assert.deepEqual(job.concurrency, { group: 'windows-esigner-signing', 'cancel-in-progress': false });
  assert.match(job.env.JSIGN_SHA256, /^[0-9a-f]{64}$/);
  const runs = job.steps.map((step) => step.run || '').join('\n');
  assert.match(runs, /sha256sum --check --strict/);
  assert.match(runs, /Get-AuthenticodeSignature/);
  assert.match(runs, /configure-release-target\.js/);
  assert.ok(!/\$\{\{\s*secrets\./.test(runs), 'secrets reach scripts through env, never pasted into them');
});

test('the mac workflow publishes to the releases repo only when RELEASES_REPO is set', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-desktop.yml'), 'utf8');
  assert.match(text, /TARGET_REPO="\$\{RELEASES_REPO:-\$GITHUB_REPOSITORY\}"/);
  assert.match(text, /BRIDGE_RELEASE:-\}" == "true"/);
  assert.match(text, /GH_TOKEN: \$\{\{ vars\.RELEASES_REPO && secrets\.RELEASES_TOKEN \|\| secrets\.GITHUB_TOKEN \}\}/);
});

test('a release tag signs Windows on the PC until WIN_SIGNING is "cloud", and passes the secrets either way', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release-desktop.yml'), 'utf8'));
  const pc = workflow.jobs['windows-build-sign-and-publish'];
  const cloud = workflow.jobs['windows-cloud-sign-and-publish'];
  assert.equal(pc.uses, './.github/workflows/release-windows-self-hosted.yml');
  assert.equal(cloud.uses, './.github/workflows/release-windows-cloud.yml');
  assert.equal(pc.if, "github.event_name == 'push' && vars.WIN_SIGNING != 'cloud'");
  assert.equal(cloud.if, "github.event_name == 'push' && vars.WIN_SIGNING == 'cloud'");
  assert.equal(pc.secrets, 'inherit', 'the bridge upload needs RELEASES_TOKEN inside the called workflow');
  assert.equal(cloud.secrets, 'inherit');
  assert.deepEqual(cloud.with, { upload: true, expected_publisher: '${{ vars.WIN_EXPECTED_PUBLISHER }}' });
});
