const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadService() {
  const storage = { getItem(key) { return this[key] ?? null; }, setItem(key,value) { this[key]=String(value); }, removeItem(key) { delete this[key]; } };
  const captures = [], timers = [], calls = [];
  const ph = {
    config: {}, sessionRecording: { status: 'lazy_loading' },
    init(_key, config) { this.config=config; },
    set_config(config) { Object.assign(this.config,config); },
    capture(name,properties) { captures.push({name,properties}); },
    startSessionRecording() { calls.push('start'); this.config.disable_session_recording=false; },
    stopSessionRecording() { calls.push('stop'); this.config.disable_session_recording=true; },
    sessionRecordingStarted() { return false; }, get_session_id() { return 'test-session'; },
    identify() {}, reset() { calls.push('reset'); },
  };
  const root=path.join(__dirname,'../src/renderer/services');
  const cache={};
  function compile(file) {
    if(cache[file])return cache[file];
    const exports={}; cache[file]=exports;
    const source=ts.transpileModule(fs.readFileSync(path.join(root,file+'.ts'),'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
    }).outputText;
    const sandbox={exports,module:{exports},require(name){
      if(name==='posthog-js')return ph;
      if(name==='../config/config')return {BACKEND_URL:'https://api.example.invalid'};
      if(name==='../../main/insight-implementation')return {judgeImplementation:()=>({implemented:false})};
      if(name.startsWith('./'))return compile(name.slice(2));
      throw new Error(name);
    },window:{location:{search:'?appVersion=1.0.130',origin:'file://'},evia:{}},localStorage:storage,
    crypto:require('node:crypto').webcrypto,URL,URLSearchParams,Date,console:{log(){},warn(){},error(){}},
    setTimeout(fn,delay){const timer={fn,delay,cancelled:false};timers.push(timer);return timer;},
    clearTimeout(timer){if(timer)timer.cancelled=true;},
    fetch:async()=>{throw new Error('not expected');}};
    vm.runInNewContext(source,sandbox,{filename:file});
    return exports;
  }
  return {service:compile('posthogService'),privacy:compile('telemetryPrivacy'),safety:compile('telemetrySafety'),ph,storage,timers,captures,calls};
}

test('recording needs consent and masks rendered content before first capture',()=>{
  const {service,ph,calls}=loadService();service.initPostHog();
  assert.equal(ph.config.disable_session_recording,true);
  assert.equal(ph.config.session_recording.maskAllInputs,true);
  assert.equal(ph.config.session_recording.maskTextSelector,'*');
  assert.equal(ph.config.session_recording.recordBody,false);
  assert.equal(ph.config.enable_recording_console_log,false);
  assert.equal(calls.includes('start'),false);
  service.applyAnalyticsConsent(true);assert.equal(ph.config.disable_session_recording,false);
  assert.equal(calls.filter(c=>c==='start').length,1);
});
test('withdrawing consent prevents an already queued health callback from restarting replay',()=>{
  const {service,timers,calls}=loadService();service.initPostHog();service.applyAnalyticsConsent(true);
  const pending=timers.at(-1);service.applyAnalyticsConsent(false);
  assert.equal(pending.cancelled,true);pending.fn();
  assert.equal(calls.filter(c=>c==='start').length,1);
  assert.equal(calls.at(-1),'stop');
});
test('logout stops replay and removes the cached consent before reset',()=>{
  const {service,storage,calls}=loadService();service.initPostHog();service.applyAnalyticsConsent(true);service.resetUser();
  assert.equal(storage.getItem('taylos_analytics_consent'),null);
  assert.deepEqual(calls.slice(-2),['stop','reset']);
});
test('content is replaced by lengths while identifiers, consent, timings and verdicts survive',()=>{
  const {privacy}=loadService();
  const clean=privacy.stripAnalyticsContent({chat_id:42,preset_id:3,latency_ms:900,
    transcript:[{text:'private prospect words'}],insight_text:'private suggestion',
    nested:{goal_text:'private goal',confidence:.8},source:'desktop',summary:true});
  assert.equal(clean.chat_id,42);assert.equal(clean.latency_ms,900);assert.equal(clean.summary,true);
  assert.equal(clean.nested.confidence,.8);assert.ok(clean.transcript_chars>0);
  assert.doesNotMatch(JSON.stringify(clean),/private/);
});
test('network metadata keeps status/timing but never request bodies, headers or query data',()=>{
  const {safety}=loadService();
  const clean=safety.sanitizeCapturedNetworkRequest({url:'https://api.example.invalid/chats?prompt=private&token=secret',status:200,duration:321,
    requestHeaders:{authorization:'Bearer secret'},responseHeaders:{x:'private'},requestBody:'private',responseBody:'private',body:'private'});
  assert.equal(clean.url,'https://api.example.invalid/chats');assert.equal(clean.status,200);assert.equal(clean.duration,321);
  assert.doesNotMatch(JSON.stringify(clean),/private|secret|Body|Headers/);
});
