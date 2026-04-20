// hooks/caveman-session-stop.test.js — unit test for slugifyCwd
const assert = require('node:assert');

// Mirror the hook's slugifyCwd implementation (hook file is side-effecting on
// load, so we can't safely require() it — duplicate the 2-line function here).
function slugifyCwd(cwd) {
  if (!cwd) return null;
  return cwd.replace(/[^A-Za-z0-9]/g, '-').replace(/^-+|-+$/g, '');
}

assert.strictEqual(
  slugifyCwd('C:\\projects\\example app'),
  'C--projects-example-app',
  'Windows path: drive-letter :\\ yields double dash; single space yields single dash'
);
assert.strictEqual(
  slugifyCwd('/home/user/proj'),
  'home-user-proj',
  'POSIX path slug — leading slash trimmed'
);
assert.strictEqual(
  slugifyCwd('C:\\a'),
  'C--a',
  'Short Windows path: :\\ → -- (no trailing dash)'
);
assert.strictEqual(slugifyCwd(''), null, 'Empty cwd returns null');
assert.strictEqual(slugifyCwd(null), null, 'Null cwd returns null');

console.log('PASS: caveman-session-stop.test.js slugifyCwd');
