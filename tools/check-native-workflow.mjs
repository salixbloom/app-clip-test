/** Local structural/shell validation; never invokes xcodebuild or GitHub. */
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseDocument} from 'yaml';
const document=parseDocument(readFileSync('.github/workflows/native-capture.yml','utf8'));
assert.deepEqual(document.errors,[]);
const workflow=document.toJS();
assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch','push']);
assert.deepEqual(workflow.on.push.branches,['codex/native-capture']);
assert.deepEqual(workflow.on.push.paths,['native/**','.github/workflows/native-capture.yml']);
assert.deepEqual(workflow.permissions,{contents:'read'});
const job=workflow.jobs.compile;
assert.equal(job['runs-on'],'macos-15');
assert.equal(job['timeout-minutes'],20);
let builds=0;
for(const step of job.steps){
 if(step.run){
  // Commands use POSIX grammar; runtime Bash's pipefail is checked separately.
  const syntax=spawnSync('sh',['-n'],{input:step.run,encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.error?.message??syntax.stderr);
  if(step.run.includes('-project native/GuidedCaptureDevice.xcodeproj')){
   assert.ok(step.run.includes('CODE_SIGNING_ALLOWED=NO'));
   assert.ok(step.run.includes('pipefail'));builds++;
  }
 }
 if(step.uses?.startsWith('actions/checkout@'))assert.equal(step.with['persist-credentials'],false);
 if(step.uses?.startsWith('actions/upload-artifact@'))assert.equal(step.with.path,'build-logs/');
}
assert.equal(builds,2);
for(const path of ['native/GuidedCaptureDevice.xcodeproj/project.pbxproj','native/GuidedCaptureDevice.xcodeproj/xcshareddata/xcschemes/CaptureHost.xcscheme','native/GuidedCapture/Resources/GuidedNative.js'])assert.ok(existsSync(path),path);
console.log('Native workflow YAML, shell syntax, unsigned build commands and local project paths PASS; no remote build performed.');
