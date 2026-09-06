const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('production Compose uses a conventional fixed latest image', () => {
  const compose = readRepositoryFile('compose.yaml');

  assert.match(compose, /image:\s+ghcr\.io\/josephlteif\/whylowdps:latest/);
  assert.doesNotMatch(compose, /WHYLOWDPS_(?:IMAGE|VERSION)/);
});

test('Docker environment example does not select the image tag', () => {
  const environment = readRepositoryFile('.env.docker.example');

  assert.doesNotMatch(environment, /^WHYLOWDPS_VERSION=/m);
  assert.match(environment, /^WHYLOWDPS_HOST_IP=/m);
});

test('Docker frontend build includes changelog synchronization inputs', () => {
  const dockerfile = readRepositoryFile('Dockerfile');

  assert.match(dockerfile, /COPY docs\/whats-new-history\.md \.\/docs\/whats-new-history\.md/);
  assert.match(dockerfile, /COPY scripts\/sync-changelog\.js \.\/scripts\/sync-changelog\.js/);
});

test('release workflow publishes latest and versioned tags and records rollback references', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/);
  assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/);
  assert.match(workflow, /type=raw,value=latest/);
  assert.doesNotMatch(workflow, /type=raw,value=stable/);
  assert.match(workflow, /WHYLOWDPS_VERSION=\$\{\{ steps\.meta\.outputs\.version \}\}/);
  assert.match(workflow, /cp \.env\.docker\.example "\$\{BUNDLE_DIR\}\/\.env\.docker\.example"/);
  assert.doesNotMatch(workflow, /sed .*WHYLOWDPS_VERSION/);
  assert.match(workflow, /whylowdps:latest.*docker-image\.txt/);
  assert.match(workflow, /whylowdps:%s.*docker-image\.txt/);
  assert.match(workflow, /whylowdps@%s.*docker-image\.txt/);
  assert.match(
    workflow,
    /name: Promote Unreleased changelog[\s\S]*node scripts\/promote-changelog\.js[\s\S]*npm run sync:changelog/
  );
  assert.match(
    workflow,
    /git add[\s\S]*CHANGELOG\.md docs\/whats-new-history\.md frontend\/src\/app\/lib\/changelog\.generated\.json/
  );
  assert.match(workflow, /finalize-release:[\s\S]*if:[\s\S]*always\(\) &&/);
});

test('release workflow has a compact stable action selector', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /release_action:[\s\S]*?- patch[\s\S]*?- promote-dev/);
  assert.doesNotMatch(workflow, /release_channel|release_mode|dev_source_ref|source_ref:/);
  assert.match(workflow, /dev_version:[\s\S]*?type: string/);
  assert.match(workflow, /stable_version:[\s\S]*?type: string/);
  assert.match(workflow, /promote-dev:[\s\S]*?DEV_TAG="dev-build\/\$\{DEV_VERSION\}"/);
  assert.match(workflow, /git checkout --detach "refs\/tags\/\$\{DEV_TAG\}"/);
  assert.match(workflow, /echo "dev_sha=\$\{DEV_SHA\}" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /promote-dev:[\s\S]*?persist-credentials: false/);
  assert.match(workflow, /promote-dev:[\s\S]*?git checkout --detach origin\/master/);
  assert.match(workflow, /promote-dev:[\s\S]*?\:\(exclude\)\.github\/workflows\/\*\*/);
  assert.match(workflow, /git tag "v\$\{VERSION\}"/);
  assert.match(workflow, /promote-dev:[\s\S]*?git config user\.name "github-actions\[bot\]"[\s\S]*?git commit -m "chore\(release\): promote/);
  assert.doesNotMatch(workflow, /ref: refs\/tags\/dev\s/);
  assert.match(workflow, /needs: \[bump-version-stable, promote-dev, validate_republish\]/);
});

test('promote-dev publishes synchronized changelog state to master', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');
  const promoteDev = workflow.slice(
    workflow.indexOf('\n  promote-dev:'),
    workflow.indexOf('\n  validate_republish:')
  );

  assert.match(
    promoteDev,
    /node scripts\/promote-changelog\.js[\s\S]*--version "\$\{VERSION\}"[\s\S]*--date/
  );
  assert.match(promoteDev, /STABLE_VERSION: \$\{\{ inputs\.stable_version \}\}/);
  assert.match(promoteDev, /promote-dev requires a stable version such as 6\.0\.0/);
  assert.match(promoteDev, /VERSION="\$\{STABLE_VERSION\}"/);
  assert.match(promoteDev, /npm run sync:changelog/);
  assert.match(promoteDev, /npm run check:changelog/);
  assert.match(
    promoteDev,
    /git add[\s\S]*CHANGELOG\.md docs\/whats-new-history\.md frontend\/src\/app\/lib\/changelog\.generated\.json/
  );
  assert.match(promoteDev, /push "https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}\.git" "HEAD:refs\/heads\/master"/);
});

test('dev release workflow is manual-only with selectable increments', () => {
  const workflow = readRepositoryFile('.github/workflows/dev-release.yml');

  assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(
    workflow,
    /workflow_dispatch:[\s\S]*?dev_increment:[\s\S]*?type: choice[\s\S]*?- patch[\s\S]*?- minor[\s\S]*?- major/
  );
  assert.match(
    workflow,
    /DEV_INCREMENT: \$\{\{ inputs\.dev_increment \}\}/
  );
  assert.match(workflow, /switch \(\$env:DEV_INCREMENT\)/);
  assert.match(workflow, /git ls-remote --exit-code origin "refs\/tags\/v\$targetVersion"/);
  assert.match(workflow, /Preserve immutable developer source tag/);
  assert.match(workflow, /git push origin "refs\/tags\/\$devTag"/);
  assert.match(workflow, /Source ref: dev-build\/\$env:DEV_VERSION/);
  assert.match(workflow, /tagName: dev/);
  assert.match(workflow, /releases\/download\/dev\/latest\.json/);
  assert.match(workflow, /latest\.json/);
  assert.doesNotMatch(workflow, /release_action|release_channel|release_mode/);
});

test('release workflow can republish an existing version without bumping it', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /release_action:[\s\S]*?- republish/);
  assert.match(workflow, /existing_version:[\s\S]*?type: string/);
  assert.match(workflow, /inputs\.release_action == 'republish'/);
  assert.match(workflow, /git ls-remote --exit-code origin "refs\/tags\/v\$\{EXISTING_VERSION\}"/);
  assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(
    workflow,
    /name: Ensure container resource paths exist[\s\S]*mkdir -p backend\/resources\/data/
  );
  assert.match(workflow, /RELEASE_TAG#v/);
});

test('manual version bumps publish in the same workflow run', () => {
  const workflow = readRepositoryFile('.github/workflows/release.yml');

  assert.match(workflow, /token: \$\{\{ secrets\.RELEASE_TOKEN \}\}/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /git push origin master[\s\S]*http\.extraheader=AUTHORIZATION: basic/);
  assert.doesNotMatch(workflow, /git push origin "v\$\{\{ steps\.bump\.outputs\.new_version \}\}"/);
  assert.match(
    workflow,
    /outputs:[\s\S]*release_tag: \$\{\{ steps\.release\.outputs\.release_tag \}\}/
  );
  assert.match(workflow, /needs: \[bump-version-stable, promote-dev, validate_republish\]/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.release_action != 'republish' && inputs\.release_action != 'promote-dev' && needs\.bump-version-stable\.result == 'success'/
  );
});
