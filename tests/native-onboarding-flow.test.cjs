const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function controller({token=null,subscribed=false,completed=false,legacyState=null}={}){
 const windows=[],persisted=[];
 const deps={
  electron:{app:{getPath:()=>'/test'},systemPreferences:{getMediaAccessStatus:()=> 'granted'}},
  keytar:{getPassword:async()=>token,setPassword:async(_s,_k,value)=>{token=value},deletePassword:async()=>{token=null}},
  fs:{existsSync:()=>completed||!!legacyState,readFileSync:()=>JSON.stringify(legacyState||{onboardingCompleted:true}),writeFileSync:(_p,s)=>persisted.push(JSON.parse(s))},path,
  './auth-token-cache':{clearCachedAuthToken(){},setCachedAuthToken(){}},
  './subscription-service':{hasActiveSubscription:async()=>subscribed,clearSubscriptionCache(){},getCachedSubscriptionStatus:()=>null},
  './overlay-windows':{createWelcomeWindow:()=>windows.push('welcome'),closeWelcomeWindow(){},createPermissionWindow:()=>windows.push('permissions'),closePermissionWindow(){},createSubscriptionWindow:()=>windows.push('checkout'),closeSubscriptionWindow(){},createHeaderWindow:()=>windows.push('ready'),getHeaderWindow:()=>null,resumeOverlayShortcuts(){}},
 };
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/header-controller.js'),'utf8'),{require:id=>{if(!(id in deps))throw Error(id);return deps[id]},exports:module.exports,module,Buffer,process:{platform:'darwin',env:{}},console:{log(){},warn(){},error(){}}});
 const c=new module.exports.HeaderController();return {c,windows,persisted};
}
const jwt=()=>`x.${Buffer.from(JSON.stringify({sub:'test',exp:Date.now()/1000+3600})).toString('base64url')}.x`;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('fresh launch waits for real registration; successful auth opens native before checkout',async()=>{
 const h=controller();let opened=0;
 h.c.setNativeOnboardingLauncher(async()=>{opened++;return {close(){}}});
 await h.c.initialize();assert.deepEqual(h.windows,['welcome']);assert.equal(opened,0);
 await h.c.handleAuthCallback(jwt());assert.equal(opened,1);assert.ok(!h.windows.includes('checkout'));
});
test('only a finished onboarding is persisted complete and then reaches checkout',async()=>{
 const h=controller({token:jwt()});let finish;let checkouts=0;
 h.c.setCheckoutLauncher(async()=>{checkouts++;});
 h.c.setNativeOnboardingLauncher(async({onClose})=>{finish=onClose;return {close(){}}});
 await h.c.initialize();finish({finished:true});await flush();
 assert.equal(h.c.isOnboardingCompleted(),true);assert.equal(h.persisted.at(-1).permissionsCompleted,true);
 assert.equal(checkouts,1);assert.ok(!h.windows.includes('ready'));
});
test('closing early does not complete setup or immediately reopen it',async()=>{
 const h=controller({token:jwt()});let finish,count=0;
 h.c.setNativeOnboardingLauncher(async({onClose})=>{finish=onClose;count++;return {close(){}}});
 await h.c.initialize();finish({finished:false});await flush();
 assert.equal(h.c.isOnboardingCompleted(),false);assert.equal(count,1);assert.equal(h.persisted.length,0);
 await h.c.restartNativeOnboarding();assert.equal(count,2);
});
test('failed launch is never persisted as a completed onboarding',async()=>{
 const h=controller({token:jwt()});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;throw Error('missing asset')});
 await h.c.initialize();assert.equal(count,1);assert.equal(h.c.isOnboardingCompleted(),false);assert.equal(h.persisted.length,0);
});
test('replay without authentication returns to registration',async()=>{
 const h=controller();let count=0;h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.restartNativeOnboarding();assert.equal(count,0);assert.deepEqual(h.windows,['welcome']);
});
test('a completed returning account goes straight to checkout without opening the bar',async()=>{
 const h=controller({token:jwt(),completed:true});let count=0;let checkouts=0;
 h.c.setCheckoutLauncher(async()=>{checkouts++;});
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);assert.equal(checkouts,1);assert.ok(!h.windows.includes('ready'));
});

test('the production registration launcher replaces the legacy welcome window',async()=>{
 const h=controller();let registrations=0;
 h.c.setRegistrationLauncher(async()=>{registrations++;});
 h.c.setNativeOnboardingLauncher(async()=>({}));
 await h.c.initialize();assert.equal(registrations,1);assert.deepEqual(h.windows,[]);
});

test('an install that predates the bundled onboarding is not forced through it on update',async()=>{
 const h=controller({token:jwt(),subscribed:true,legacyState:{permissionsCompleted:true}});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);assert.equal(h.c.isOnboardingCompleted(),true);assert.deepEqual(h.windows,['ready']);
 await h.c.restartNativeOnboarding();assert.equal(count,1);
});
test('a pre-1.0.109 install that never finished permissions still gets first-run setup',async()=>{
 const h=controller({token:jwt(),legacyState:{permissionsCompleted:false}});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,1);
});
// 2026-09-16: a tester's whole first run left no event and no replay - the
// onboarding window served its own page, blocked every other host and loaded
// no PostHog. These pin the pieces that make the flow visible.
const runtime=path.join(__dirname,'../onboarding-runtime/output/onboarding-prototype');
const read=file=>fs.readFileSync(path.join(runtime,file),'utf8');
test('the onboarding page bundles PostHog and its replay recorder, and initialises analytics',()=>{
 const html=read('goal-first-atlas-practice.html');
 assert.match(html,/vendor\/posthog\.js/);
 assert.match(html,/vendor\/posthog-recorder\.js/,'the recorder is a separate lazy bundle; without it replay never starts');
 assert.ok(fs.existsSync(path.join(runtime,'vendor/posthog.js'))&&fs.existsSync(path.join(runtime,'vendor/posthog-recorder.js')));
 const page=read('goal-first-atlas-practice.js');
 assert.match(page,/import \{analytics\} from '\.\/onboarding-analytics\.js'/);
 assert.match(page,/analytics\.track\('onboarding_started'/);
 assert.equal((page.match(/analytics\.step\(/g)||[]).length,3,'first view plus both branches of go()');
 assert.match(page,/analytics\.terminal\('onboarding_finish_clicked'/);
 assert.match(page,/analytics\.terminal\('onboarding_closed'/);
});
test('the shell lets PostHog EU through its request allowlist only when analytics is on, and waits for the last event',()=>{
 const shell=read('local-onboarding.cjs');
 assert.match(shell,/https:\/\/eu\.i\.posthog\.com\//);
 assert.match(shell,/const analytics = embedded \|\| process\.env\.TAYLOS_ONBOARDING_ANALYTICS === '1'/);
 assert.match(shell,/analytics && analyticsHosts\.some/);
 assert.match(shell,/analytics=1&app_version=/);
 assert.match(shell,/if\(analytics\) await new Promise\(resolve=>setTimeout\(resolve,600\)\)/);
});
test('onboarding replay masks what the tester types',()=>{
 const analytics=read('onboarding-analytics.js');
 assert.match(analytics,/maskAllInputs: true/);
 assert.match(analytics,/maskTextSelector: '\[data-ph-mask\], \.context-fields/);
 assert.match(analytics,/params\.get\('analytics'\) === '1'/,'previews and screenshot runs stay silent');
});
