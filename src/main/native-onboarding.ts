import { app, BrowserWindow, desktopCapturer, dialog, shell, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import * as keytar from 'keytar';
import { headerController } from './header-controller';
import { suspendOverlayShortcuts, resumeOverlayShortcuts } from './overlay-windows';
import { webAppUrl } from './web-app-url';

export function onboardingPermissions() {
  const microphone = systemPreferences.getMediaAccessStatus('microphone');
  const screen = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
  return { live: true, microphone, screen };
}

async function requestPermissions(channel: string) {
  if (channel === 'onboarding:request-microphone') {
    if (process.platform === 'darwin') {
      if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
      if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    } else if (process.platform === 'win32') await shell.openExternal('ms-settings:privacy-microphone');
  } else if (channel === 'onboarding:request-screen' && process.platform === 'darwin') {
    try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }); } catch { /* The system dialog can deny capture. */ }
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  return onboardingPermissions();
}

export async function saveContext(context: any, token: string) {
  const fields = context?.fields || {};
  const mapping: Record<string, string> = { result:'goal',callType:'call_type',sellerName:'seller_name',sellerRole:'seller_role',company:'company',offer:'offer',proof:'proof',pricing:'pricing',buyer:'target_customer',needs:'customer_context',industry:'industry',objections:'objections',style:'sales_style',frameworks:'frameworks',coaching:'coaching_focus' };
  const answers: Record<string, string> = Object.fromEntries(Object.entries(mapping).map(([from,to])=>[to, String(fields[from] || '').slice(0,20000)]));
  answers.goal ||= String(context?.customGoal || context?.goal || '');
  answers.customer_context = [answers.customer_context,fields.situation,fields.contact].filter(Boolean).join('\n');
  answers.offer = [answers.offer, fields.difference && `Why us: ${fields.difference}`].filter(Boolean).join('\n');
  answers.coaching_focus = [answers.coaching_focus,fields.suggestions,fields.script].filter(Boolean).join('\n');
  const body = new FormData();
  body.set('answers_json', JSON.stringify(answers));
  body.set('website', String(context?.website || ''));
  body.set('language', 'en');
  body.set('use_ai', 'false');
  const documents = context?.documentData || [];
  if (!Array.isArray(documents) || documents.length > 5) throw new Error('Choose up to five documents.');
  for (const document of documents) {
    const bytes = Buffer.from(document.bytes);
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Each document must be under 10 MB.');
    body.append('documents', new Blob([new Uint8Array(bytes)], { type: document.type || 'application/octet-stream' }), path.basename(document.name));
  }
  const api = 'https://api.taylos.ai';
  async function request(route: string, init: RequestInit = {}) {
    const response = await fetch(api + route, { ...init, headers:{ Authorization:`Bearer ${token}`, ...init.headers }, signal:AbortSignal.timeout(90000) });
    if (!response.ok) throw Object.assign(new Error(`Could not save your context (${response.status}). Please try again.`), {status:response.status});
    return response.json();
  }
  let draft;
  try { draft = await request('/onboarding/profile/draft', { method:'POST',body }); }
  catch (error: any) {
    if (error.status !== 404) throw error;
    // The older production backend supports profiles but not source import yet.
    // Preserve actual inputs locally and ask before continuing without importing.
    if (documents.length || context?.website) {
      const result = await dialog.showMessageBox({type:'info', title:'Source import is not available yet',
        message:'Your typed profile can be saved now.',
        detail:'Website and document import is not available on the Taylos server yet. Keep a copy on this Mac and continue with your typed answers, or return to setup.',
        buttons:['Return to setup','Keep sources for later and continue'],defaultId:0,cancelId:0});
      if(result.response !== 1) throw new Error('Your sources have not been imported. You can return to setup or continue with your typed profile.');
      const directory=path.join(app.getPath('userData'),'pending-onboarding-sources',Date.now().toString());
      fs.mkdirSync(directory,{recursive:true,mode:0o700});
      fs.writeFileSync(path.join(directory,'context.json'),JSON.stringify({fields,website:context.website,documents:documents.map((d:any)=>d.name)}),{mode:0o600});
      for(const [index,document] of documents.entries())fs.writeFileSync(path.join(directory,`${index+1}-${path.basename(document.name)}`),Buffer.from(document.bytes),{mode:0o600});
    }
    draft={compiled_content:['# My Sales Profile','Use these facts as context for suggestions. Do not invent missing information.',
      ...Object.entries(answers).filter(([,value])=>value.trim()).map(([key,value])=>`## ${key.replace(/_/g,' ')}\n${value}`)].join('\n\n')};
  }
  if (!draft.compiled_content) throw new Error('Your profile could not be prepared. Please try again.');
  const prompts = await request('/prompts');
  const existing = prompts.find((item: any)=>['My Sales Profile','Mein Sales-Profil'].includes(item.name));
  const saved = await request(existing ? `/prompts/${existing.id}` : '/prompts', { method:existing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'My Sales Profile',description:'Company, customer and coaching context.',content:draft.compiled_content,language:'en',...(!existing ? {is_active:false}:{})}) });
  await request(`/prompts/${saved.id}/activate`, {method:'POST'});
}

/** The regular app owns authentication, real permissions and profile persistence. */
export function registerNativeOnboarding() {
  headerController.setRegistrationLauncher(async () => {
    await shell.openExternal(webAppUrl('https://app.taylos.ai/register?source=desktop'));
  });
  headerController.setNativeOnboardingLauncher(async ({ onClose, restart }) => {
    process.env.TAYLOS_EMBEDDED_ONBOARDING = '1';
    const entry = app.isPackaged
      ? path.join(process.resourcesPath,'onboarding-preview/output/onboarding-prototype/local-onboarding.cjs')
      : path.resolve(__dirname,'../../onboarding-runtime/output/onboarding-prototype/local-onboarding.cjs');
    const progressPath=path.join(app.getPath('userData'),'onboarding-progress.json');
    const accountToken=await keytar.getPassword('taylos','token');
    const account=accountToken ? JSON.parse(Buffer.from(accountToken.split('.')[1],'base64url').toString()) : null;
    const accountId=account?.sub || account?.username;
    let resume=null,lastCheckpoint='';
    if(!restart)try{const saved=JSON.parse(fs.readFileSync(progressPath,'utf8'));if(saved.account===accountId)resume=saved.checkpoint;}catch{}
    const visible = BrowserWindow.getAllWindows().filter(win=>win.isVisible());
    suspendOverlayShortcuts();
    visible.forEach(win=>win.hide());
    try {
      const { startOnboarding } = require(entry);
      return await startOnboarding({
        requestHost: requestPermissions,
        resume,
        onCheckpoint: (checkpoint: unknown) => {
          const next=JSON.stringify({account:accountId,checkpoint});
          if(next===lastCheckpoint)return;
          lastCheckpoint=next;
          fs.writeFileSync(progressPath,next,{mode:0o600});
        },
        readAccount: async () => {
          const token = await keytar.getPassword('taylos','token');
          if (!token) return null;
          const identity = JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
          return { email:identity.email || null, username:identity.sub || identity.username || 'User' };
        },
        onFinish: async (context: unknown) => {
          const token = await keytar.getPassword('taylos','token');
          if (!token) throw new Error('Please sign in again to finish setup.');
          await saveContext(context, token);
          await shell.openExternal(webAppUrl(`https://app.taylos.ai/checkout?source=desktop&desktop_token=${encodeURIComponent(token)}`));
        },
        onClose: (result: { finished: boolean }) => {
          if(result.finished && fs.existsSync(progressPath))fs.unlinkSync(progressPath);
          resumeOverlayShortcuts();onClose(result);
        },
      });
    } catch (error) {
      resumeOverlayShortcuts();
      dialog.showErrorBox('Taylos setup could not open', 'Please reopen Taylos or use Help → Run Taylos Setup Again. Your setup has not been marked complete.');
      throw error;
    }
  });
}
