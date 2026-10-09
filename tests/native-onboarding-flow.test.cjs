const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function controller({token=null,subscribed=false,completed=false,legacyState=null,platform='darwin',authStatus=200}={}){
 const windows=[],persisted=[];
 const deps={
  electron:{app:{getPath:()=>'/test'},systemPreferences:{getMediaAccessStatus:()=> 'granted'}},
  keytar:{getPassword:async()=>token,setPassword:async(_s,_k,value)=>{token=value},deletePassword:async()=>{token=null}},
  fs:{existsSync:()=>completed||!!legacyState||!!token,readFileSync:()=>JSON.stringify(legacyState||{onboardingCompleted:completed,onboardingRequired:!!token&&!completed,permissionsCompleted:completed}),writeFileSync:(_p,s)=>persisted.push(JSON.parse(s))},path,
  './auth-token-cache':{clearCachedAuthToken(){},setCachedAuthToken(){}},
  './subscription-service':{hasActiveSubscription:async()=>subscribed,clearSubscriptionCache(){},getCachedSubscriptionStatus:()=>null,getBackendUrl:()=> 'https://api.taylos.ai'},
  './overlay-windows':{createWelcomeWindow:()=>windows.push('welcome'),closeWelcomeWindow(){},createPermissionWindow:()=>windows.push('permissions'),closePermissionWindow(){},createSubscriptionWindow:()=>windows.push('checkout'),closeSubscriptionWindow(){},createHeaderWindow:()=>windows.push('ready'),getHeaderWindow:()=>null,resumeOverlayShortcuts(){},restoreOverlayUi(){},hideAllChildWindows(){},suspendOverlayShortcuts(){}},
 };
 const module={exports:{}};
 const fetch=async(_url,init)=>({ok:authStatus===200,status:authStatus,json:async()=>({username:JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1],'base64url')).sub,is_active:true})});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/header-controller.js'),'utf8'),{require:id=>{if(!(id in deps))throw Error(id);return deps[id]},exports:module.exports,module,Buffer,AbortSignal,fetch,process:{platform,env:{}},console:{log(){},warn(){},error(){}}});
 const c=new module.exports.HeaderController();return {c,windows,persisted};
}
const jwt=(sub='test')=>`x.${Buffer.from(JSON.stringify({sub,exp:Date.now()/1000+3600})).toString('base64url')}.x`;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('fresh launch waits for real registration; successful auth opens native before checkout',async()=>{
 const h=controller();let opened=0;
 h.c.setNativeOnboardingLauncher(async()=>{opened++;return {close(){}}});
 await h.c.initialize();assert.deepEqual(h.windows,['welcome']);assert.equal(opened,0);
 await h.c.handleAuthCallback(jwt(),{newAccount:true});assert.equal(opened,1);assert.ok(!h.windows.includes('checkout'));
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
test('a failed presentation restores the normal subscribed UI without completing setup',async()=>{
 const h=controller({token:jwt(),subscribed:true,platform:'win32'});
 h.c.setNativeOnboardingLauncher(async()=>{throw Error('presentation timeout');});
 await h.c.initialize();
 assert.deepEqual(h.windows,['ready']);
 assert.equal(h.c.isOnboardingCompleted(),false);
 assert.equal(h.persisted.length,0);
});
test('a second launch while presentation is pending does not create another owner',async()=>{
 const h=controller({token:jwt(),subscribed:true});let count=0,release;
 h.c.setNativeOnboardingLauncher(async()=>{count++;await new Promise(resolve=>{release=resolve;});return {focus(){}};});
 const first=h.c.initialize();await flush();
 const second=h.c.restartNativeOnboarding();await flush();
 assert.equal(count,1);
 release();await Promise.all([first,second]);
 assert.equal(count,1);assert.equal(h.persisted.length,0);
});
test('closing during startup cannot reinstall a stale handle or prevent retry',async()=>{
 const h=controller({token:jwt(),subscribed:true});let count=0;
 h.c.setNativeOnboardingLauncher(async({onClose})=>{count++;if(count===1){onClose({finished:false});return {focus(){assert.fail('stale handle');}};}return {};});
 await h.c.initialize();await flush();
 assert.equal(h.c.isOnboardingCompleted(),false);
 await h.c.restartNativeOnboarding();assert.equal(count,2);
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
 const h=controller();let registrations=0;let returning=null;
 h.c.setRegistrationLauncher(async(options)=>{registrations++;returning=options.returning;});
 h.c.setNativeOnboardingLauncher(async()=>({}));
 await h.c.initialize();assert.equal(registrations,1);assert.equal(returning,false);assert.deepEqual(h.windows,[]);
});
test('an expired session opens sign-in, not sign-up: an existing user must land on the dashboard',async()=>{
 const expired=`x.${Buffer.from(JSON.stringify({sub:'test',exp:Date.now()/1000-60})).toString('base64url')}.x`;
 const h=controller({token:expired});let returning=null;
 h.c.setRegistrationLauncher(async(options)=>{returning=options.returning;});
 h.c.setNativeOnboardingLauncher(async()=>({}));
 await h.c.initialize();assert.equal(returning,true);
});
test('a machine that finished setup before opens sign-in after logout',async()=>{
 const h=controller({token:jwt(),completed:true});let returning=null;
 h.c.setRegistrationLauncher(async(options)=>{returning=options.returning;});
 h.c.setCheckoutLauncher(async()=>{});
 h.c.setNativeOnboardingLauncher(async()=>({}));
 await h.c.initialize();await h.c.handleLogout();assert.equal(returning,true);
});

test('an install that predates the bundled onboarding is not forced through it on update',async()=>{
 const h=controller({token:jwt(),subscribed:true,legacyState:{permissionsCompleted:true}});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);assert.equal(h.c.isOnboardingCompleted(),true);assert.deepEqual(h.windows,['ready']);
 await h.c.restartNativeOnboarding();assert.equal(count,1);
});
test('an old authenticated install is not forced into signup setup',async()=>{
 const h=controller({token:jwt(),legacyState:{permissionsCompleted:false}});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);
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
 assert.match(shell,/const analytics = \(embedded \|\| process\.env\.TAYLOS_ONBOARDING_ANALYTICS === '1'\) && options\.analytics !== false/);
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

// 25 Sep 2026: the web app launched Desktop with a new account's token on a
// Mac where the founder had finished setup. Desktop swapped the token, kept the
// machine-wide "completed" flag and skipped onboarding for the new account.
test('another account handed over by the web app gets its own onboarding',async()=>{
 const h=controller({token:jwt('founder'),completed:true,subscribed:true});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);
 await h.c.handleAuthCallback(jwt('payment-tester'),{newAccount:true});assert.equal(count,1);
 assert.equal(h.c.isOnboardingCompleted(),false);
});
test('the same account signing in again keeps its finished setup',async()=>{
 const h=controller({token:jwt('founder'),completed:true,subscribed:true});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();await h.c.handleAuthCallback(jwt('founder'));assert.equal(count,0);
});
test('finishing onboarding records the account, which still counts after its token expired',async()=>{
 const h=controller({token:jwt('founder')});let finish;
 h.c.setNativeOnboardingLauncher(async({onClose})=>{finish=onClose;return {close(){}}});
 await h.c.initialize();finish({finished:true});await flush();
 assert.equal(h.persisted.at(-1).onboardingAccount,'founder');
 const later=controller({legacyState:{onboardingCompleted:true,permissionsCompleted:true,onboardingAccount:'founder'},subscribed:true});let count=0;
 later.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await later.c.initialize();await later.c.handleAuthCallback(jwt('founder'));assert.equal(count,0);
 await later.c.handleAuthCallback(jwt('someone-else'),{newAccount:true});assert.equal(count,1);
});

test('logout preserves completed setup across re-login and process restart',async()=>{
 const h=controller({token:jwt('founder'),completed:true,subscribed:true});let count=0;
 h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();await h.c.handleLogout();
 assert.equal(h.c.isOnboardingCompleted(),true);
 const saved=h.persisted.at(-1);
 assert.equal(saved.onboardingAccount,'founder');assert.equal(saved.hadSession,true);
 await h.c.handleAuthCallback(jwt('founder'));assert.equal(count,0);assert.equal(h.windows.at(-1),'ready');
 const later=controller({legacyState:saved,subscribed:true});
 later.c.setNativeOnboardingLauncher(async()=>{assert.fail('returning login must not onboard')});
 await later.c.handleAuthCallback(jwt('founder'));assert.equal(later.windows.at(-1),'ready');
});

test('a returning login with already granted OS permissions opens the bar, not signup setup',async()=>{
 const h=controller({subscribed:true});
 h.c.setNativeOnboardingLauncher(async()=>{assert.fail('existing account must not onboard')});
 await h.c.handleAuthCallback(jwt('existing'));assert.equal(h.windows.at(-1),'ready');
});

test('reopening while the browser was closed opens registration again',async()=>{
 const h=controller();let opened=0;
 h.c.setRegistrationLauncher(async()=>{opened++});
 await h.c.initialize();await h.c.reopen();assert.equal(opened,2);
});

test('logout suppresses a late onboarding completion and does not reopen a browser from web logout',async()=>{
 const h=controller({token:jwt(),subscribed:true});let finish;let opened=0;
 h.c.setRegistrationLauncher(async()=>{opened++});
 h.c.setNativeOnboardingLauncher(async({onClose})=>{finish=onClose;return {close(){onClose({finished:true})}}});
 await h.c.initialize();await h.c.handleLogout({openBrowser:false});finish({finished:true});await flush();
 assert.equal(h.c.isOnboardingCompleted(),false);assert.equal(h.c.getCurrentState(),'welcome');assert.equal(opened,0);
});

test('an invalid browser handoff cannot replace a completed session',async()=>{
 const h=controller({token:jwt('founder'),completed:true,authStatus:401});
 await assert.rejects(h.c.handleAuthCallback(jwt('attacker')),/session has expired/);
 assert.equal(h.c.isOnboardingCompleted(),true);assert.equal(h.persisted.length,0);
});
