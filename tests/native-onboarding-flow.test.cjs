const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function controller({token=null,subscribed=false,completed=false}={}){
 const windows=[],persisted=[];
 const deps={
  electron:{app:{getPath:()=>'/test'},systemPreferences:{getMediaAccessStatus:()=> 'granted'}},
  keytar:{getPassword:async()=>token,setPassword:async(_s,_k,value)=>{token=value},deletePassword:async()=>{token=null}},
  fs:{existsSync:()=>completed,readFileSync:()=>JSON.stringify({onboardingCompleted:true}),writeFileSync:(_p,s)=>persisted.push(JSON.parse(s))},path,
  './auth-token-cache':{clearCachedAuthToken(){},setCachedAuthToken(){}},
  './subscription-service':{hasActiveSubscription:async()=>subscribed,clearSubscriptionCache(){},getCachedSubscriptionStatus:()=>null},
  './overlay-windows':{createWelcomeWindow:()=>windows.push('welcome'),closeWelcomeWindow(){},createPermissionWindow:()=>windows.push('permissions'),closePermissionWindow(){},createSubscriptionWindow:()=>windows.push('checkout'),closeSubscriptionWindow(){},createHeaderWindow:()=>windows.push('ready'),getHeaderWindow:()=>null},
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
 const h=controller({token:jwt()});let finish;
 h.c.setNativeOnboardingLauncher(async({onClose})=>{finish=onClose;return {close(){}}});
 await h.c.initialize();finish({finished:true});await flush();
 assert.equal(h.c.isOnboardingCompleted(),true);assert.equal(h.persisted.at(-1).permissionsCompleted,true);assert.ok(h.windows.includes('checkout'));
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
test('a completed returning account goes straight to subscription gate',async()=>{
 const h=controller({token:jwt(),completed:true});let count=0;h.c.setNativeOnboardingLauncher(async()=>{count++;return {}});
 await h.c.initialize();assert.equal(count,0);assert.deepEqual(h.windows,['checkout']);
});

test('the production registration launcher replaces the legacy welcome window',async()=>{
 const h=controller();let registrations=0;
 h.c.setRegistrationLauncher(async()=>{registrations++;});
 h.c.setNativeOnboardingLauncher(async()=>({}));
 await h.c.initialize();assert.equal(registrations,1);assert.deepEqual(h.windows,[]);
});
