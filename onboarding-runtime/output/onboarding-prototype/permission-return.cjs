// Watch only permissions the user explicitly requested; stop when resolved/closed.
module.exports=function createPermissionReturn({check,request,notify,restore,setTimer=setInterval,clearTimer=clearInterval}){
  const pending=new Set();let timer=null,closed=false,checking=false,last='';
  function publish(status){
    if(closed)return status;
    const fingerprint=JSON.stringify(status);
    if(fingerprint!==last){last=fingerprint;notify(status);}
    let granted=false;
    for(const key of pending)if(status[key]==='granted'){pending.delete(key);granted=true;}
    if(granted)restore();
    if(!pending.size&&timer!==null){clearTimer(timer);timer=null;}
    return status;
  }
  async function refresh(){
    if(closed||checking)return;
    checking=true;
    try{return publish(await check());}catch{}finally{checking=false;}
  }
  return {
    async request(channel){
      if(channel==='onboarding:permissions')return publish(await check());
      const key=channel==='onboarding:request-microphone'?'microphone':channel==='onboarding:request-screen'?'screen':null;
      if(!key)throw Error('Unsupported permission request');
      const before=await check();
      if(before[key]==='granted'){restore();return publish(before);}
      pending.add(key);
      if(timer===null)timer=setTimer(()=>void refresh(),750);
      return publish(await request(channel));
    },
    refresh,
    close(){closed=true;pending.clear();if(timer!==null)clearTimer(timer);timer=null;},
  };
};
