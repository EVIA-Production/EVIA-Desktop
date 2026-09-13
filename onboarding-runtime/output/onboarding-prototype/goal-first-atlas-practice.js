import {translate, goalsDe} from './onboarding-i18n.js';
(() => {
  "use strict";
  // The real renderer is an ES module bundle and needs the local HTTP origin.
  if (location.protocol === "file:") {
    location.replace("http://127.0.0.1:4177/output/onboarding-prototype/goal-first-atlas-practice");
    return;
  }
  const root = document.querySelector("#prototype-root");
  const mark = "../../EVIA-Desktop/src/renderer/overlay/assets/taylos_mark.png";
  const appIcon = "../../EVIA-Desktop/src/main/assets/icon-mac.png";
  const sfPath = "../TAYLOS_SF_SYMBOLS_PACKAGE/03_VECTOR_SVG/medium/";
  const checkout = "https://app.taylos.ai/checkout?source=desktop";
  let livePermissions = false, permissionBusy = false;
  const documentFiles = new Map();
  // Keep the picker and validation aligned with the existing text extractors.
  const documentExtensions = ['.pdf','.docx','.pptx','.xlsx','.txt','.md'];
  let documentErrorTimer=0;
  const views = ["welcome", "ask", "goal", "prepare", "permissions", "transcript", "insights", "suggestion", "review", "personalize"];
  const storageKey = "taylos-onboarding-final-preview-v2";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; } })();
  const state = {
    view: "welcome", goal: saved.goal || null, customGoal: saved.customGoal || "", permission: 0, visible: true,
    platform: /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "win",
    language: new URLSearchParams(location.search).get("lang") || saved.language || (navigator.language.toLowerCase().startsWith("de") ? "de" : "en"),
    // German is withheld until onboarding feedback justifies it. The language is
    // still resolved from the system so re-enabling is one entry here.
    layout: "de", showLabel: "#", history: 1, section: "company",
    fields: saved.fields || {}, website: saved.website || "", documents: [],
    launching: true, success: "", toast: "", paused: false, websiteError: false
  };
  const ONBOARDING_LANGUAGES = ['en'];
  state.language = ONBOARDING_LANGUAGES.includes(state.language) ? state.language : 'en';
  const t = text => translate(text,state.language);
  function L(markup) {
    if(state.language!=='de')return markup;
    const template=document.createElement('template');template.innerHTML=markup;
    const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_TEXT);
    let node;while((node=walker.nextNode()))node.textContent=t(node.textContent);
    template.content.querySelectorAll('*').forEach(el=>{
      for(const attr of ['title','placeholder','aria-label','alt'])if(el.hasAttribute(attr))el.setAttribute(attr,t(el.getAttribute(attr)));
    });
    return template.innerHTML;
  }
  function changeLanguage(language) {
    if(!ONBOARDING_LANGUAGES.includes(language)||language===state.language)return;
    state.language=language;save();artworkKey='';renderedPhase='';
    root.querySelector('.phase-mount').innerHTML='';controls.innerHTML='';render();
  }
  const pressed = new Set();
  let transitionTimer = 0;
  let toastTimer = 0;
  let introTimer = 0;
  let lightTimer = 0;
  let manualLayout = false;
  let customShortcuts = {};

  const goals = {
    needs: {
      icon: "scan-search",
      prospect: ["Interested in the outcome, hesitant about the change.","Speaks for a team, not only for themselves.","Risk is personal here, not budgetary."],
      analysis: ["The objection is disruption, not value.","No one has named who absorbs the switching cost.","A reversible first step removes most of the fear."],
      actions: ["What should I say next?","Ask what a safe first test looks like","Name the cost of changing nothing"],
      choice: "Understand the customer's pain",
      opener: "Before I show you anything, what are you trying to improve?",
      reason: "This starts with the customer's situation instead of your pitch.",
      customer: "I like the idea, but changing our process sounds risky.",
      seller: "What would make the change feel safe for your team?",
      insight: "The customer is not rejecting the value. They are worried about disruption and personal risk.",
      action: "Reduce risk before discussing features or price.",
      suggestion: "That makes sense. What works well today, and what still costs your team time?",
      worked: "You explored the customer's risk instead of defending the product.",
      next: "Clarify what a safe, low-effort first test would require."
    },
    value: {
      icon: "presentation",
      prospect: ["Defends the current process rather than the budget.","Has not seen a failure they attribute to it yet.","Wants proof against their work, not a tour."],
      analysis: ["A feature tour will confirm their objection.","One costly step in their process is the wedge.","Proof must be tied to something they already lose."],
      actions: ["What should I say next?","Ask which step costs the most time","Offer one concrete comparison"],
      choice: "Show how your product helps",
      opener: "What would this conversation need to prove to be useful for you?",
      reason: "This lets the customer define what a valuable demonstration must show.",
      customer: "We already have a process that works. I do not see why we need another tool.",
      seller: "Which part of the current process takes the most effort or gets missed most often?",
      insight: "The customer needs proof tied to an existing problem, not a broader feature tour.",
      action: "Connect one product capability to one costly part of the current process.",
      suggestion: "Understood. Which part of the current process takes the most time or creates the most uncertainty?",
      worked: "You moved from a feature pitch to the customer's existing workflow.",
      next: "Demonstrate one result against the problem the customer identifies."
    },
    next: {
      icon: "handshake",
      prospect: ["Has not refused; the next step is simply undefined.","Needs to carry this to someone else internally.","Asking for material to end the call politely."],
      analysis: ["\u201cSend me something\u201d leaves the next step undefined.","The real blocker is an unnamed internal question.","Name an owner and a date for the next decision."],
      actions: ["What should I say next?","Ask what the material must answer","Propose an owner and a date"],
      choice: "Close the deal",
      opener: "Before we move forward, is there anything that would stop this from being the right decision?",
      reason: "This makes the customer's decision criteria explicit before proposing a commitment.",
      customer: "Send me something first. I need to discuss it internally.",
      seller: "What question will your team need the material to answer?",
      insight: "The customer has not refused. The next step is vague because the internal decision is unclear.",
      action: "Define the internal question, owner, and time for the next decision.",
      suggestion: "Of course. What is the one question the material must answer for your team?",
      worked: "You made the internal decision process concrete without applying pressure.",
      next: "Confirm the material, owner, and date for a short follow-up."
    },
    meeting: {
      icon: "calendar-plus",
      prospect: ["Protecting time, not rejecting the topic.","Has given you a minute to earn the next one.","Will decide on relevance, not on your pitch."],
      analysis: ["Relevance has to land before any ask for time.","One precise question outperforms an introduction.","The meeting is earned by the question, not the offer."],
      actions: ["What should I say next?","Ask where their calls lose time","Offer a short, specific meeting"],
      choice: "Book a first meeting",
      opener: "Can I ask one question to see whether a conversation would be useful?",
      reason: "This earns attention before asking the customer to commit time.",
      customer: "I only have a minute. What is this about?",
      seller: "Where does your team lose the most time during customer calls today?",
      insight: "The customer is protecting time. Relevance must be established before proposing a meeting.",
      action: "Use one concise question to establish a reason for a longer conversation.",
      suggestion: "I'll keep it brief. Where does your team lose the most time during customer calls today?",
      worked: "You respected the customer's time and tested relevance first.",
      next: "If the problem is relevant, offer a short meeting with a specific purpose."
    }
  };



  const orderedGoals = Object.fromEntries(['meeting', 'needs', 'value', 'next'].map(id => [id, goals[id]]));
  const sections = {
    goal: { title: "Goal with Taylos", hint: "What you want to achieve.", fields: [
      ["result", "What would a successful call achieve?", "For example, agree on a product trial"],
      ["callType", "What kinds of calls do you make?", "Discovery, product demos, follow-ups..."]
    ]},
    company: { title: "Who you are", hint: "What you sell and why it works.", fields: [
      ["offer", "What do you sell?", "Your product, service, and the problem it solves"],
      ["proof", "What proves it works?", "Customer results, examples, or references"],
      ["pricing", "What are your pricing boundaries?", "Prices, discounts, and promises Taylos should respect"],
      ["difference", "Why do customers choose you?", "What makes your offer different"],
      ["sellerName", "Your name", "Name"],
      ["sellerRole", "Your role", "Role or job title"],
      ["company", "Your company", "Company name"]
    ]},
    customers: { title: "Who your prospect is", hint: "Who they are and what matters to them.", fields: [
      ["buyer", "Who do you sell to?", "Roles, company types, and industries"],
      ["needs", "What are they trying to improve?", "Their problems, use cases, and reasons to buy"],
      ["situation", "What should Taylos recognize?", "Common situations or buying signals"],
      ["industry", "Which industries do they work in?", "Industries or markets"],
      ["contact", "Who will you speak to?", "Name, role, and what you know about this customer"]
    ]},
    help: { title: "How Taylos should help", hint: "The guidance you want in the moment.", fields: [
      ["objections", "Which objections come up?", "Common concerns and answers you know are true"],
      ["style", "How do you like to sell?", "Your tone, approach, or sales framework"],
      ["coaching", "Where do you want more help?", "Sales, technical questions, emotional cues..."],
      ["frameworks", "Which sales frameworks do you use?", "For example, SPIN or MEDDIC"],
      ["suggestions", "How should suggestions sound?", "Short and direct, or more consultative"],
      ["script", "Do you use a call script?", "Add your script for Taylos to follow and adapt"]
    ]}
  };
  const copy = {
    welcome: ["Start the setup by showing the Taylos bar", "to reach your goals with Taylos faster. It's already hidden on your screen."],
    ask: ["The Taylos bar floats over your windows.", "You can hide and show it whenever you need."],
    goal: ["Here you can prepare before the call.", "You can ask questions before, during or after a call."],
    prepare: ["Right before a call, press {Listen} so Taylos can hear what you hear and give live suggestions.", ""],
    permissions: ["Let's let Taylos hear the call.", ""],
    permissionsWin: ["Let Taylos use your microphone.",
      "In Windows Settings, enable microphone access for desktop apps, then return to Taylos."],
    transcript: ["Blue is you. Grey is your prospect.", ""],
    insights: ["Taylos' Insights show you what sales experts would think in your situation.", ""],
    suggestion: ["Taylos suggests a response for the situation and the Action you chose.", ""],
    review: ["After the call, Taylos helps you to improve, follow up and learns from every call.", "To get the most from Taylos, improve its suggestions through Personalization."],
    personalize: ["Improve Your Suggestions", "Add information about your situation so Taylos can give more relevant tips"]
  };
  const captions = {
    ask: "",
    goal: "",
    prepare: "",
    transcript: "",
    insights: "",
    suggestion: "",
    review: ""
  };

  function escape(value) {
    return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
  }
  function sf(name, extra = "") {
    const native=['doc.fill','progress.indicator','checkmark'].includes(name);
    const asset=native?'assets/sf/'+name+'.png':sfPath+name+'.svg';
    return '<span aria-hidden="true" class="sf ' + (native?'native-symbol ':'') + extra +
      '" style="--symbol:url(' + asset + ')"></span>';
  }
  function logo(extra = "") { return '<img class="taylos-mark ' + extra + '" src="' + mark + '" alt="" />'; }
  // {Listen} {Insights} {Stop} are not lookalikes: the markup, the SVGs and the
  // glass spec are lifted from EviaBar.tsx and ListenView.tsx so the sentence
  // shows the user the control they are about to press.
  const WAVEFORM_SVG = '<svg width="12" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1.69922 2.7515C1.69922 2.37153 2.00725 2.0635 2.38722 2.0635H2.73122C3.11119 2.0635 3.41922 2.37153 3.41922 2.7515V8.2555C3.41922 8.63547 3.11119 8.9435 2.73122 8.9435H2.38722C2.00725 8.9435 1.69922 8.63547 1.69922 8.2555V2.7515Z" fill="white"/>' +
    '<path d="M5.13922 1.3755C5.13922 0.995528 5.44725 0.6875 5.82722 0.6875H6.17122C6.55119 0.6875 6.85922 0.995528 6.85922 1.3755V9.6315C6.85922 10.0115 6.55119 10.3195 6.17122 10.3195H5.82722C5.44725 10.3195 5.13922 10.0115 5.13922 9.6315V1.3755Z" fill="white"/>' +
    '<path d="M8.57922 3.0955C8.57922 2.71553 8.88725 2.4075 9.26722 2.4075H9.61122C9.99119 2.4075 10.2992 2.71553 10.2992 3.0955V7.9115C10.2992 8.29147 9.99119 8.5995 9.61122 8.5995H9.26722C8.88725 8.5995 8.57922 8.29147 8.57922 7.9115V3.0955Z" fill="white"/></svg>';
  const STOP_SVG = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="9" height="9" rx="1" fill="white"/></svg>';
  const INSIGHTS_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M9 11l3 3L22 4"/><path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';
  function rich(text) {
    return escape(t(text)).replace(/\{(Listen|Insights|Stop)\}/g, (_, label) => {
      if (label === 'Insights')
        return '<span class="inline-control toggle-button hovered">' + INSIGHTS_SVG + '<span>'+t('Insights')+'</span></span>';
      const live = label === 'Stop';
      return '<span class="inline-control evia-listen-button' + (live ? ' listen-active' : '') + '">' +
        '<span class="evia-listen-label">' + t(label) + '</span>' +
        '<span class="evia-listen-icon">' + (live ? STOP_SVG : WAVEFORM_SVG) + '</span></span>';
    });
  }
  function localizedGoals(){return state.language==='de'?Object.fromEntries(Object.entries(orderedGoals).map(([id,g])=>[id,{...g,...goalsDe[id]}])):orderedGoals;}
  function goal() {const all=localizedGoals();return state.goal==='custom'?{...all.needs,choice:state.customGoal}:all[state.goal]||all.needs;}
  function isMac() { return state.platform === "mac"; }
  function mod() { return isMac() ? "⌘" : "Ctrl"; }
  function keyList(type) {
    const saved=customShortcuts[shortcutIds[type]];
    if(saved)return saved.split('+').map(key=>({Command:mod(),Cmd:mod(),Control:isMac()?'⌃':'Ctrl',Ctrl:isMac()?'⌃':'Ctrl',Alt:isMac()?'⌥':'Alt',Option:isMac()?'⌥':'Alt',Shift:'⇧',Enter:'↵',Return:'↵'})[key]||key.toUpperCase());
    if (type === "show") return [mod(), isMac() ? state.showLabel.toUpperCase() : "Space"];
    if (type === "ask") return [mod(), isMac() ? "↵" : "Enter"];
    return [isMac() ? "⌥" : "Alt", type === "previous" ? "J" : "K"];
  }
  function keyCodes(type) {
    const saved=customShortcuts[shortcutIds[type]];
    if(saved)return saved.split('+').map(key=>({Command:'modifier',Cmd:'modifier',Control:'control',Ctrl:'control',Alt:'alt',Option:'alt',Shift:'shift',Return:'Enter','\\':'Backslash','#':'Backslash'})[key] || (/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():/^\d$/.test(key)?'Digit'+key:key));
    return [type === "show" || type === "ask" ? (isMac() ? "modifier" : "control") : "alt",
      type === "show" ? (isMac() ? "Backslash" : "Space") : type === "ask" ? "Enter" : type === "previous" ? "KeyJ" : "KeyK"];
  }
  const shortcutIds={show:'toggleVisibility',ask:'nextStep',previous:'previousResponse',next:'nextResponse'};
  function keys(type, size = "") {
    return '<span class="keys ' + size + '">' + keyList(type).map((key, i) =>
      (i ? '<span class="key-plus" aria-hidden="true">+</span>' : "") +
      '<kbd data-key="' + keyCodes(type)[i] + '">' + escape(key) + '</kbd>').join("") + '</span>';
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ language:state.language, goal:state.goal, customGoal:state.customGoal, fields:state.fields, website:state.website })); } catch {}
  }
  function phase() {
    const i = views.indexOf(state.view);
    return i <= 3 ? 0 : i <= 7 ? 1 : 2;
  }
  function phases() {
    if (state.view === "welcome") return "";
    return '<nav class="phases" aria-label="Call phases"><i class="phase-lens" aria-hidden="true"></i>' +
      ["Before the call", "During the call", "After the call"].map((label, i) =>
        '<span class="phase ' + (phase() === i ? "active" : "") + '" aria-label="' + label + '" ' + (phase() === i ? 'aria-current="step"' : "") +
        '>' + (phase() === i ? '<span>' + t(label) + '</span>' : '') + '</span>').join("") + '</nav>';
  }
  function progress() {
    const group = phase() === 0 ? views.slice(0,4) : phase() === 1 ? views.slice(4,8) : views.slice(8);
    const current = group.indexOf(state.view);
    return '<span class="step-dots" aria-label="Step ' + (current+1) + ' of ' + group.length + '">' +
      group.map((_,i) => '<i class="' + (i===current ? "active" : i<current ? "done" : "") + '"></i>').join("") + '</span>';
  }
  function meeting() {
    if(!isMac())return "";
    return '<div class="meeting" aria-hidden="true"><div class="meeting-art"></div></div>';
  }
  function watermark() { return '<span class="watermark">' + logo() + '</span>'; }
  function welcomeImage() {
    return '<div class="welcome-image"><img src="assets/welcome-meeting.webp" alt="Taylos live sales assistant shown over a meeting" />' +
      '<div class="welcome-title"><h1>Welcome to Taylos</h1><span class="rule"></span>' +
      '<p>The sales call AI that tells you live what sales experts would say.</p></div></div>';
  }
  root.addEventListener('dragstart',event=>{if(event.target.closest('.welcome-image,.meeting'))event.preventDefault();});
  root.addEventListener('contextmenu',event=>{if(event.target.closest('.welcome-image,.meeting'))event.preventDefault();});
  const permissionArt = ["assets/permission-mic.webp", "assets/permission-audio.webp"];
  function permissionCursor() {
    return '<img class="permission-cursor" src="assets/macos-arrow-cursor.png" alt="" draggable="false" />';
  }
  // Existing OS illustrations, with annotations kept separate from the images.
  function permissionStage() {
    if (isMac()) {
      return '<div class="permission-stage">' + permissionArt.map((src,i)=>
        '<figure class="permission-shot '+(i===0?'microphone':'call-audio')+' '+(state.permission===i?'current':'')+'">'+
        '<div class="permission-image"><img src="'+src+'" alt="'+(i===0?'Example macOS microphone dialog: choose Allow.':'Example macOS call audio dialog: open System Settings.')+'" />'+permissionCursor()+'</div>'+
        '</figure>').join('')+'</div>';
    }
    return '<div class="permission-stage win"><div class="windows-permission-shots">'+[1,2,3].map((n)=>
      '<figure class="windows-permission-shot shot-'+n+'"><img draggable="false" src="assets/windows-microphone-'+n+'.jpeg" alt="Windows microphone settings: '+['Microphone access','Let apps access your microphone','Let desktop apps access your microphone'][n-1]+'" /></figure>').join('')+'</div></div>';
  }

  const personalTabs = [["goal","Goal"],["company","You"],["customers","Prospect"],["help","Taylos"]];
  const rowLabels = {
    result:"Successful call", callType:"Call types",
    offer:"What you sell", proof:"Proof", pricing:"Pricing", difference:"Why you",
    sellerName:"Your name", sellerRole:"Your role", company:"Company",
    buyer:"Buyer", needs:"Their goals", situation:"Signals", industry:"Industries", contact:"Contact",
    objections:"Objections", style:"Selling style", coaching:"Extra help",
    frameworks:"Frameworks", suggestions:"Tone", script:"Call script"
  };
  function validWebsite(value) {
    if(!value || /\s/.test(value))return false;
    try {
      const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);
      // URL() treats bare numbers ("123") as IPv4 addresses. A website needs a
      // domain name, not that implicit numeric conversion or embedded credentials.
      return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
        url.hostname.includes('.') && /[a-z]/i.test(url.hostname.split('.').at(-1)) &&
        url.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
    } catch {return false;}
  }
  function personalizationStage() {
    const selected = sections[state.section];
    const siteState = state.websiteState || (validWebsite(state.website.trim()) ? "saved" : "empty");
    return '<div class="personalization-stage"><div class="apple-window">' +
      '<div class="apple-titlebar"><span class="traffic"><i></i><i></i><i></i></span>' +
      '<div class="glass-tabs" role="tablist" aria-label="Sales context"><span class="tabs-lens" aria-hidden="true"></span>' +
      personalTabs.map(([id,label]) => '<button role="tab" data-action="section" data-section="' + id + '" class="' +
        (state.section===id ? "selected" : "") + '" aria-selected="' + (state.section===id) + '">' + label + '</button>').join("") +
      '</div></div>' +
      '<div class="apple-body" role="tabpanel">' +
        '<div class="apple-group website-group t-input-wrap ' + siteState + (state.websiteError ? ' is-error' : '') + '">' +
          '<form id="website-form" class="apple-row"><span class="apple-row-label">Website</span>' +
            '<span class="apple-field"><input id="company-website" class="t-input' + (state.websiteError ? ' is-error' : '') + '" aria-label="Website" aria-describedby="website-error" aria-invalid="' + state.websiteError + '" inputmode="url" spellcheck="false" ' +
              'value="' + escape(state.website) + '" placeholder="yourcompany.com" /></span>' +
            '<button type="submit" class="apple-row-action" aria-label="' + (siteState==='loading'?'Saving website':siteState==='saved'?'Website saved':'Add website') + '" ' + (siteState==='loading'?'disabled':'') + '>' +
              (siteState==="loading" ? sf('progress.indicator','website-progress') :
               siteState==="saved"   ? '<span class="t-success-check" data-state="'+(animateWebsiteSymbol?'out':'settled')+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7" pathLength="20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'  : 'Add') + '</button></form>' +
          '<p id="website-error" class="t-error-msg" role="alert">' + (state.websiteError ? 'Enter a website, e.g. yourcompany.com.' : '') + '</p>' +
        '</div>' +
        '<div class="apple-group context-fields">' + selected.fields.map(([id,label,placeholder]) =>
          '<div class="apple-row" title="' + escape(label) + '"><span class="apple-row-label">' + escape(rowLabels[id] || label) + '</span>' +
          '<span class="apple-field"><input data-field="' + id + '" aria-label="' + escape(rowLabels[id] || label) + '" value="' + escape(state.fields[id]||"") +
          '" placeholder="' + escape(placeholder) + '" /></span></div>').join("") + '</div>' +
        '<label class="apple-drop ' + (state.documents.length ? "filled" : "") + '">' +
          '<input id="document-input" type="file" multiple accept="' + documentExtensions.join(',') + '" />' +
          '<span class="document-trigger">'+sf("doc.fill")+'<span class="t-badge" data-open="false" aria-hidden="true"><span class="t-badge-dot">'+state.documents.length+'</span></span></span>' +
          '<b>Add Documents</b><small>PDF, Word, Slides, Notes</small>' +
        '</label>' +
        '<p class="apple-footnote">You can always add more in the Dashboard. The more context, the better.</p>' +
      '</div></div></div>';
  }
  function stageContent() {
    if (state.view==="welcome") return welcomeImage();
    if (state.view==="permissions") return permissionStage();
    if (state.view==="personalize") return personalizationStage();
    return (captions[state.view] ? '<div class="stage-caption">' + captions[state.view] + '</div>' : '') +
      (["transcript","insights","suggestion"].includes(state.view) ? meeting() : "");
  }
  function shortcutCoach(type) {
    const alternate = type==="show" ? 'or click the ' + logo("inline-mark") + ' icon in your ' + (isMac() ? "Mac's menu bar" : "Windows system tray") : "or click Ask in the Taylos bar.";
    return '<div class="shortcut-coach">' + (type==="show" ? '<span>Press both keys together to show Taylos</span>' : '<strong>Next, open the Ask window.</strong>') +
      '<button class="shortcut-button ' + (state.success===type ? "success" : "") + '" data-action="' + (type==="show" ? "show" : "open-ask") +
      '" aria-label="' + (type==="show" ? "Show Taylos" : "Open the Ask window") + '">' + keys(type,"large") +
      '</button><button class="shortcut-alternative" data-action="' + (type==="show" ? "show" : "open-ask") + '">' + alternate + '</button></div>';
  }
  function permissionControls() {
    const rows = [["mic.fill","Microphone","Hear your voice."],
                  ["waveform","Call audio","Hear the other person through your meeting app."]];
    return '<div class="permission-controls">' + rows.map(([symbol,title,body],i) => {
      // Windows: loopback is always available, so call audio is already settled and
      // the microphone is the only row that can still be waiting.
      const done = isMac() ? state.permission>i : i===1 || state.permission>0;
      const active = isMac() ? state.permission===i : i===0 && state.permission===0;
      return '<div class="permission-option ' + (done ? "granted" : active ? "active" : "queued") +
        '">' + sf(symbol) + '<span><b>' + title + '</b><small>' + body + '</small></span>' +
        '<span class="glass-toggle ' + (done ? "on" : "") + '" aria-label="' +
        (done ? "Allowed" : "Not yet allowed") + '" data-on="'+done+'"><i><span class="toggle-refraction"></span></i></span></div>';
    }).join("") + '</div>';
  }
  function historyControls() {
    return '<div class="history-coach"><p>Go back and forth between suggestions.</p><div>' +
      [["previous","Previous"],["next","Next"]].map(([type,label]) =>
      '<button data-action="' + type + '" class="history-shortcut"' + ((type==='previous' ? state.history===0 : state.history===1) ? ' disabled' : '') + '><span>' + t(label) + '</span>' + keys(type,"medium") + '</button>').join("") + '</div></div>';
  }
  function interaction() {
    if(state.view==="welcome") return shortcutCoach("show");
    if(state.view==="ask") return shortcutCoach("ask");
    if(state.view==="goal") return '<div class="next-instruction"><strong>Now choose your goal - let\'s start a practice call.</strong><p>You can change this before any call.</p></div>';
    if(state.view==="transcript") return '<div class="next-instruction">' + rich('You can toggle in between transcript view and {Insights} to see live sales analysis.') + '</div>';
    if(state.view==="insights") return '<div class="next-instruction one-line">Select an Action to steer the call and get live sales, technical or emotional suggestions.</div>';
    if(state.view==="permissions") return permissionControls();
    if(state.view==="suggestion") return '<div class="stop-instruction">' + rich("Once you've reached your goal, press {Stop} to enter the next phase.") + '</div>' + historyControls();
    if(state.view==="personalize") return '';
    return '';
  }
  function navigationChevron(back=false) {
    return '<span class="t-learn-direction'+(back?' reverse':'')+'" aria-hidden="true"><span class="t-learn-chevron"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path class="t-learn-arm t-learn-arm-top" d="M6 4L10 8"/><path class="t-learn-arm t-learn-arm-bot" d="M10 8L6 12"/></svg></span></span>';
  }
  function footer() {
    const left=state.view==="welcome" ? '<a class="button quiet" data-action="finish" href="' + checkout + '">Skip Setup</a>' :
      '<button class="button quiet t-learn" data-action="back">' + navigationChevron(true) + ' Back</button>';
    let right="";
    if(state.view==="prepare") right='<button class="button white t-learn" data-action="listen">Start Practice Call ' + navigationChevron() + '</button>';
    if(state.view==="permissions") right = isMac()
      ? '<button class="button permission-primary" data-action="grant">' +
        (state.permission===0 ? "Allow microphone" : state.permission===1 ? "Allow call audio" : "Start practice call") + '</button>'
      : '<div class="permission-actions"><button class="button quiet" data-action="continue-preview">' + (livePermissions ? 'Continue' : 'Continue preview') + '</button><button class="button permission-primary" data-action="open-mic-settings">Open Windows Settings</button></div>';
    if(state.view==="review") right='<button class="button white t-learn" data-action="done">Personalize Suggestions ' + navigationChevron() + '</button>';
    if(state.view==="personalize") right='<a class="button permission-primary" data-action="finish" href="' + checkout + '">Finish Setup</a>';
    if(state.view==="personalize") return right+'<div class="personalization-footer-row">'+left+'<a class="legal-link" href="https://taylos.ai/legal" target="_blank" rel="noopener noreferrer">Legal</a></div>';
    return left + '<div class="footer-position ' + (right ? "middle" : "right") + '">' + progress() + '</div>' + right;
  }

  root.innerHTML='<div class="desktop"><div class="light-field" aria-hidden="true">' +
    Array.from({length:5},()=>'<div class="rays beam"></div>').join('') +
    '</div>' +
    '<div class="window-wrap"><section class="onboarding-card" aria-label="Taylos setup">' +
    '<div class="onboarding-drag-region" aria-hidden="true"></div>' +
    '<div class="showcase"><div class="stage-art"></div><iframe class="native-overlay-frame" title="Taylos desktop overlay" src="' + (window.taylosLocal?'about:blank':'native-build/') + '"></iframe></div>' +
    '<div class="instruction-zone"><div class="phase-mount"></div><div class="instruction-main"><div class="copy-block"><div class="copy-media"></div><h1></h1><p></p></div><div class="interaction-zone"></div></div><footer class="card-footer"></footer></div></section>' +
    '<div class="launch-icon"><img class="launch-base" src="' + appIcon + '" alt="" /><img class="launch-symbol" src="' + mark + '" alt="Taylos" /></div></div><div class="toast" role="status"></div></div>';
  const card=root.querySelector(".onboarding-card");
  const stage=root.querySelector(".showcase");
  const stageArt=root.querySelector(".stage-art");
  let animateWebsiteSymbol=false;
  function syncWebsiteSymbol() { /* Success now animates in the same DOM as its trigger. */ }
  function syncPersonalizationMotion() {
    const tabs=stageArt.querySelector('.glass-tabs'), active=tabs?.querySelector('[aria-selected=true]'), lens=tabs?.querySelector('.tabs-lens');
    if(active&&lens){
      lens.style.transition='none';
      lens.style.width=active.offsetWidth+'px';lens.style.transform='translateX('+active.offsetLeft+'px)';
      lens.getBoundingClientRect();lens.style.removeProperty('transition');
    }
    const badge=stageArt.querySelector('.t-badge');
    const check=stageArt.querySelector('.t-success-check[data-state=out]');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(badge?.isConnected)badge.dataset.open=String(state.documents.length>0);
      if(check?.isConnected){check.dataset.state='in';animateWebsiteSymbol=false;}
    }));
  }
  new MutationObserver(syncPersonalizationMotion).observe(stageArt,{childList:true});
  new ResizeObserver(syncPersonalizationMotion).observe(stageArt);
  const nativeFrame=root.querySelector(".native-overlay-frame");
  const copyBlock=root.querySelector(".copy-block");
  const controls=root.querySelector(".interaction-zone");
  const footerElement=root.querySelector(".card-footer");
  const instructionMain=root.querySelector(".instruction-main");
  const instructionZone=root.querySelector(".instruction-zone");

  const barSpotlight=document.createElement('div');
  barSpotlight.className='bar-spotlight';barSpotlight.setAttribute('aria-hidden','true');
  root.querySelector('.desktop').append(barSpotlight);
  barSpotlight.addEventListener('animationend',()=>barSpotlight.classList.remove('introducing'));
  const wrap=root.querySelector(".window-wrap");
  root.querySelectorAll('.rays').forEach((beam,i)=>{
    beam.style.animation='none';
    let angle=i*72+(Math.random()-.5)*12, currentDrift;
    reduced.addEventListener("change",()=>{currentDrift?.cancel();if(!reduced.matches)drift();});
    const drift=()=>{
      if(reduced.matches)return;
      const next=angle+(Math.random()-.5)*42;
      const motion=currentDrift=beam.animate([{transform:'translate(-50%,-50%) rotate('+angle+'deg)'},{transform:'translate(-50%,-50%) rotate('+next+'deg)'}],{duration:28000+Math.random()*24000,easing:'ease-in-out',fill:'forwards'});
      motion.onfinish=()=>{angle=next;motion.cancel();drift();};

    };drift();
  });
  const dragRegion=root.querySelector('.onboarding-drag-region');
  let cardDrag=null,cardOffset={x:0,y:0};
  dragRegion.addEventListener('pointerdown',e=>{
    if(e.button!==0||state.launching)return;
    e.preventDefault();
    window.taylosLocal?.setPointerInside(true);
    const r=wrap.getBoundingClientRect();
    cardDrag={x:e.clientX,y:e.clientY,offset:{...cardOffset},rect:r};
    dragRegion.setPointerCapture(e.pointerId);
  });
  dragRegion.addEventListener('pointermove',e=>{
    if(!cardDrag)return;
    const r=cardDrag.rect;
    const dx=Math.max(12-r.left,Math.min(innerWidth-r.right-12,e.clientX-cardDrag.x));
    const dy=Math.max(12-r.top,Math.min(innerHeight-r.bottom-12,e.clientY-cardDrag.y));
    cardOffset={x:cardDrag.offset.x+dx,y:cardDrag.offset.y+dy};
    document.documentElement.style.setProperty('--card-x',cardOffset.x+'px');
    document.documentElement.style.setProperty('--card-y',cardOffset.y+'px');
    requestGeometry();
  });
  dragRegion.addEventListener('pointerup',e=>{cardDrag=null;dragRegion.releasePointerCapture(e.pointerId);});
  dragRegion.addEventListener('pointercancel',()=>{cardDrag=null;});
  let renderedView = '';
  let renderedPhase = '';
  let artworkKey = '';
  const restore = document.createElement('button');
  restore.className='restore-overlay';restore.dataset.action='show';restore.title='Show Taylos';
  restore.innerHTML=logo()+'<span>Show Taylos</span>';stage.append(restore);
  function updateArtwork() {
    const key=['transcript','insights','suggestion'].includes(state.view)?'meeting'+state.platform:state.view+state.platform+(state.view==='permissions'?state.permission:'');
    if(key!==artworkKey){stageArt.innerHTML=L(stageContent());artworkKey=key;}
    stageArt.querySelectorAll('.permission-shot').forEach((el,i)=>el.classList.toggle('current',state.permission===i));
    restore.hidden=state.visible||['welcome','permissions','personalize'].includes(state.view);
  }
  function render(animate = false) {
    const previous=stage.querySelector(".overlay-stack")?.getBoundingClientRect();
    card.dataset.view=state.view;
    document.documentElement.lang=state.language;
    root.querySelectorAll('[data-action=language]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.language===state.language)));
    restore.innerHTML=logo()+'<span>'+t('Show Taylos')+'</span>';restore.title=t('Show Taylos');
    document.documentElement.dataset.platform=state.platform;
    updateArtwork();
    nativeFrame.hidden=!!window.taylosLocal || !state.visible || ["welcome","permissions","personalize"].includes(state.view);
    sendNative();
    const c=(state.view==="permissions" && !isMac() && copy.permissionsWin) || copy[state.view];
    copyBlock.querySelector(".copy-media").innerHTML = "";
    copyBlock.querySelector("h1").innerHTML=rich(c[0]);
    copyBlock.querySelector("p").innerHTML=rich(c[1]);
    instructionMain.append(controls);
    if(state.view==='permissions' && controls.querySelector('.permission-controls')) {
      const next=document.createElement('div');next.innerHTML=L(permissionControls());
      controls.querySelectorAll('.permission-option').forEach((row,i)=>{
        const target=next.querySelectorAll('.permission-option')[i];row.className=target.className;
        const toggle=row.querySelector('.glass-toggle'),newToggle=target.querySelector('.glass-toggle');
        const changed=toggle.dataset.on!==newToggle.dataset.on;
        const initialized=changed||toggle.classList.contains('is-init');
        toggle.className=newToggle.className+(initialized?' is-init':'');
        toggle.dataset.on=newToggle.dataset.on;toggle.setAttribute('aria-label',newToggle.getAttribute('aria-label'));
      });
    } else controls.innerHTML=L(interaction());
    instructionZone.append(footerElement);
    footerElement.innerHTML=L(footer());
    const phaseMarkup=L(phases());
    if(phaseMarkup!==renderedPhase){
      const mount=root.querySelector('.phase-mount');
      if(!phaseMarkup||!mount.querySelector('.phases'))mount.innerHTML=phaseMarkup;
      else mount.querySelectorAll('.phase').forEach((el,i)=>{
        el.classList.toggle('active',i===phase());
        if(i===phase())el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
      });
      const active=mount.querySelector('.phase.active'),lens=mount.querySelector('.phase-lens');
      if(active&&lens){lens.style.width=active.offsetWidth+'px';lens.style.transform='translateX('+active.offsetLeft+'px)';}
      renderedPhase=phaseMarkup;
    }
    document.querySelector("#review-count").textContent=(views.indexOf(state.view)+1)+" / "+views.length;
    document.querySelector("#prototype-phase").textContent="Interactive prototype";
    document.querySelectorAll("[data-action=platform]").forEach(b=>b.classList.toggle("is-active",b.dataset.platform===state.platform));
    document.querySelectorAll("[data-action=layout]").forEach(b=>b.classList.toggle("is-active",b.dataset.layout===state.layout));
    if (animate && renderedView!==state.view && !reduced.matches) {
      const stack=stage.querySelector(".overlay-stack");
      if(stack) {
        const now=stack.getBoundingClientRect();
        const dy=previous ? previous.top-now.top : 14;
        stack.animate([{opacity:previous?1:0,transform:"translateY("+dy+"px)"},{opacity:1,transform:"translateY(0)"}],{duration:480,easing:"cubic-bezier(.16,1,.3,1)"});
      }
    }
    renderedView=state.view;
    syncKeys();
  }
  // Permission screens are deterministic review fixtures on both platforms.
  // Production must use its capture service to distinguish access from signal.
  async function refreshPermissions() {
    if (!window.taylosLocal?.request) return;
    const result = await window.taylosLocal.request('onboarding:permissions');
    if (!result?.live) return;
    livePermissions = true;
    state.permission = result.microphone === 'granted' ? (result.screen === 'granted' ? 2 : 1) : 0;
    if (state.view === 'permissions') render(true);
  }
  async function permissionViewNeeded() { await refreshPermissions(); return !livePermissions || state.permission < 2; }
  async function grantRealPermission() {
    if (permissionBusy) return;
    permissionBusy = true;
    try {
      await refreshPermissions();
      if (state.permission === 2) { go('transcript'); return; }
      await window.taylosLocal.request(state.permission === 0 ? 'onboarding:request-microphone' : 'onboarding:request-screen');
      await refreshPermissions();
      if (state.permission === 2) go('transcript');
      else toast('Allow Taylos in System Settings, then return here to continue.');
    } catch { toast('Could not check permissions. Please try again.'); }
    finally { permissionBusy = false; }
  }
  window.addEventListener('focus',()=>{ if(state.view==='permissions')void refreshPermissions(); });

  function go(view) {
    if(!views.includes(view))return;
    clearTimeout(transitionTimer);
    const main=root.querySelector('.instruction-main');
    if(state.view!==view && !reduced.matches && main) {
      // The outgoing copy accelerates off the left edge; the incoming copy enters
      // from the right at that same speed and decelerates into place.
      const forward = views.indexOf(view) > views.indexOf(state.view);
      main.dataset.dir = forward ? 'fwd' : 'back';
      const artGroup=v=>['welcome','permissions','personalize'].includes(v)?v:['transcript','insights','suggestion','review'].includes(v)?'meeting':'blue';
      const artworkChanges=artGroup(state.view)!==artGroup(view);
      stage.dataset.dir=main.dataset.dir;
      sendProduct({type:'product-transition',phase:'out',direction:forward?1:-1});
      stage.classList.remove('stage-entering');if(artworkChanges)stage.classList.add('stage-leaving');
      main.classList.remove('entering');
      main.classList.add('leaving');
      transitionTimer=setTimeout(()=>{
        main.classList.remove('leaving');stage.classList.remove('stage-leaving');
        state.direction=forward?1:-1;
        state.view=view;state.visible=true;state.success="";state.toast="";
        render(true);save();
        main.classList.add('entering');if(artworkChanges)stage.classList.add('stage-entering');
        setTimeout(()=>{main.classList.remove('entering');stage.classList.remove('stage-entering');},420);
      },250);
      return;
    }
    state.view=view;state.visible=true;state.success="";state.toast="";
    render(true);save();
  }
  async function goSkippingPermissions(view, direction) {
    if (view === "permissions" && !(await permissionViewNeeded())) {
      const i = views.indexOf(view);
      go(views[direction < 0 ? i - 1 : i + 1]);
      return;
    }
    go(view);
  }
  function history(direction) {
    if(state.view!=="suggestion")return;
    state.history=Math.max(0,Math.min(1,state.history+direction));
    sendProduct({type:"taylos-history",index:state.history});
    controls.innerHTML=L(interaction());syncKeys();
  }
  function show() {
    if(state.launching)return;
    if(state.view==="welcome"){
      if(state.success)return;
      state.success="show";render();
      transitionTimer=setTimeout(()=>go("ask"),260);
    } else { state.visible=!state.visible;render(true); }
  }
  function ask() {
    if(state.launching)return;
    if(state.view==="ask"){
      if(state.success)return;
      state.success="ask";render();
      transitionTimer=setTimeout(()=>go("goal"),220);
    } else if(window.taylosLocal)sendProduct({type:'toggle-ask'});
    else if(state.view==="suggestion") {
      state.history=1;state.visible=true;render(true);
    } else if(state.view==='goal') nativeFrame.contentWindow?.focus();
  }
  function toast(message) {
    const element=root.querySelector(".toast");
    element.textContent=t(message);element.classList.add("visible");
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove("visible"),2400);
  }
  function restart() {
    clearTimeout(transitionTimer);clearTimeout(introTimer);
    state.view="welcome";state.visible=true;state.success="";state.permission=0;state.history=1;
    render();intro();
  }
  function intro() {
    state.launching=true;
    document.documentElement.dataset.intro='true';
    window.dispatchEvent(new Event('taylos-intro'));
    wrap.classList.remove("launching","launched");
    void wrap.offsetWidth;
    wrap.classList.add("launching");
    card.inert=true;
    clearTimeout(lightTimer);
    lightTimer=setTimeout(()=>{
      document.documentElement.dataset.intro='card';
      root.querySelector(".light-field")?.classList.add("lit");
    },reduced.matches?60:2500);
    introTimer=setTimeout(()=>{
      state.launching=false;card.inert=false;
      document.documentElement.dataset.intro='false';
      wrap.classList.remove("launching");wrap.classList.add("launched");
      root.querySelector(".light-field")?.classList.add("lit");
      root.querySelector(".desktop")?.classList.add("lit-stage");
      sendNative();
    },reduced.matches?200:3400);
  }
  document.addEventListener("click",async event=>{
    const b=event.target.closest("[data-action]");if(!b)return;
    const a=b.dataset.action;
    if(a==='close'){if(window.taylosLocal)window.taylosLocal.close();else{wrap.hidden=true;root.querySelector('.light-field').classList.remove('lit');}return;}
    if(a==="language"){changeLanguage(b.dataset.language);return;}
    if(a==="platform"){state.platform=b.dataset.platform;render();return;}
    if(a==="layout"){manualLayout=true;state.layout=b.dataset.layout;state.showLabel=state.layout==="de"?"#":"\\";render();return;}
    if(a==="restart"){restart();return;}
    if(a==="review-next"||a==="review-back"){
      clearTimeout(introTimer);state.launching=false;card.inert=false;wrap.classList.remove("launching");wrap.classList.add("launched");
      const i=views.indexOf(state.view)+(a==="review-next"?1:-1);if(views[i])go(views[i]);return;
    }
    if(state.launching)return;
    if(a==="show")show();
    else if(a==="open-ask")ask();
    else if(a==="choose-goal"){state.goal=b.dataset.goal;go("prepare");}
    else if(a==="listen"&&state.view==="prepare")goSkippingPermissions(state.permission===2?"transcript":"permissions",1);
    else if(a==="continue-preview"){if(livePermissions)await grantRealPermission();else {state.permission=2;go("transcript");}}
    else if(a==="grant"){
      if(livePermissions){await grantRealPermission();return;}
      if(state.permission<1){state.permission++;render(true);}
      else {state.permission=2;render();transitionTimer=setTimeout(()=>go("transcript"),460);}
    }
    else if(a==="insights"&&["transcript","insights"].includes(state.view))go("insights");
    else if(a==="transcript"&&["transcript","insights"].includes(state.view))go("transcript");
    else if(a==="suggestion"){state.history=1;go("suggestion");}
    else if(a==="previous")history(-1);
    else if(a==="next")history(1);
    else if(a==="stop"&&["transcript","insights","suggestion"].includes(state.view))go("review");
    else if(a==="done"&&state.view==="review")go("personalize");
    else if(a==="section"){
      state.section=b.dataset.section;
      const tabs=b.closest('.glass-tabs');
      tabs.querySelectorAll('[role=tab]').forEach(tab=>{const active=tab===b;tab.classList.toggle('selected',active);tab.setAttribute('aria-selected',String(active));});
      const lens=tabs.querySelector('.tabs-lens');lens.style.width=b.offsetWidth+'px';lens.style.transform='translateX('+b.offsetLeft+'px)';
      const next=document.createElement('div');next.innerHTML=L(personalizationStage());
      stageArt.querySelector('.context-fields').replaceWith(next.querySelector('.context-fields'));
    }
    else if(a==="open-mic-settings"){
      if(window.taylosLocal)window.taylosLocal.send({type:'navigate',url:'ms-settings:privacy-microphone'});
      else toast('Opens Windows Settings on a Windows machine.');
    }
    else if(a==="back"){
      const i=views.indexOf(state.view);if(i>0)goSkippingPermissions(views[i-1],-1);
    }else if(a==="finish"){
      if(state.view==='personalize' && state.website.trim() && !validWebsite(state.website.trim())){event.preventDefault();setWebsiteError(true);return;}
      save();
      if(window.taylosLocal){
        event.preventDefault();if(b.getAttribute('aria-disabled')==='true')return;
        b.setAttribute('aria-disabled','true');b.textContent='Saving your setup…';
        try {
          const documentData=await Promise.all([...documentFiles.values()].map(async file=>({name:file.name,type:file.type,bytes:new Uint8Array(await file.arrayBuffer())})));
          window.taylosLocal.send({type:'finish-setup',context:{language:state.language,goal:state.goal,customGoal:state.customGoal,fields:state.fields,website:state.website,documents:state.documents,documentData}});
        } catch { b.removeAttribute('aria-disabled');b.textContent='Finish Setup';toast('Could not read your documents. Please try again.'); }
      }
    }

  });
  document.addEventListener("input",e=>{
    if(e.target.dataset.field){state.fields[e.target.dataset.field]=e.target.value;save();}
    if(e.target.id==="company-website"){
      state.website=e.target.value;state.websiteState="empty";setWebsiteError(false);save();
      const button=stageArt.querySelector('.apple-row-action');
      if(button){button.innerHTML=t('Add');button.disabled=false;button.setAttribute('aria-label',t('Add website'));}
      // The green comes from the row's state class, not the button — clear it too.
      const group=stageArt.querySelector('.website-group');
      if(group){group.classList.remove('saved','loading','found');group.classList.add('empty');}
      animateWebsiteSymbol=false;
      syncWebsiteSymbol();
    }
  });
  function updateWebsiteControls() {
    const next=document.createElement('div');next.innerHTML=L(personalizationStage());
    stageArt.querySelector('.website-group')?.replaceWith(next.querySelector('.website-group'));
    // The fresh row renders its check at "out", which has no style. Without this
    // the saved state was invisible until an unrelated re-render happened.
    syncPersonalizationMotion();
  }
  let websiteErrorTimer=0;
  let spotlightWatchdog=0;
  function setWebsiteError(invalid) {
    state.websiteError=invalid;
    clearTimeout(websiteErrorTimer);
    const group=stageArt.querySelector('.website-group');
    const input=group?.querySelector('input');
    const message=group?.querySelector('.t-error-msg');
    if(!group)return;
    group.classList.toggle('is-error',invalid);
    input?.classList.toggle('is-error',invalid);
    input?.classList.remove('is-shaking');
    input?.setAttribute('aria-invalid',String(invalid));
    if(invalid){
      message.textContent=t('Enter a website, e.g. yourcompany.com.');
      input?.focus();
      // A second invalid submission should give the same local feedback.
      void input.offsetWidth;
      input.classList.add('is-shaking');
      // Same recovery as a rejected document: the field returns to normal by itself.
      websiteErrorTimer=setTimeout(()=>{ if(state.websiteError) setWebsiteError(false); },3000);
    }
  }
  function submitWebsite(advance=false) {
    if(state.websiteState==='loading')return;
      const input=document.querySelector("#company-website");
      const value=(input?.value||"").trim();
      if(!value){setWebsiteError(true);return;}
      if(!validWebsite(value)){setWebsiteError(true);return;}
      setWebsiteError(false);
      state.website=value;state.websiteState="loading";save();updateWebsiteControls();
      if(advance)stageArt.querySelector('.context-fields input')?.focus();
      // This preview saves context locally. It does not claim to crawl a website.
      setTimeout(()=>{
        if(state.website!==value)return;
        state.websiteState="saved";animateWebsiteSymbol=true;save();
        if(state.view==='personalize')updateWebsiteControls();
      },750);
  }
  document.addEventListener("submit",e=>{
    if(e.target.id!=="website-form")return;
    e.preventDefault();submitWebsite(document.activeElement?.id==='company-website');
  });
  function documentFeedback(input,invalid) {
    const drop=input.closest('.apple-drop');
    clearTimeout(documentErrorTimer);
    drop.classList.toggle('is-error',invalid);
    drop.classList.remove('is-shaking');
    input.setAttribute('aria-invalid',String(invalid));
    if(!invalid)return;
    void drop.offsetWidth;
    drop.classList.add('is-shaking');
    documentErrorTimer=setTimeout(()=>{
      drop.classList.remove('is-error','is-shaking');
      input.setAttribute('aria-invalid','false');
    },3000);
  }
  document.addEventListener("change",e=>{
    if(e.target.id==="document-input"){
      const files=Array.from(e.target.files);
      if(!files.length)return;
      const documents=[...new Set([...state.documents,...files.map(f=>f.name)])];
      const invalid=documents.length>5 || files.some(file=>
        !documentExtensions.some(extension=>file.name.toLowerCase().endsWith(extension)) ||
        file.size===0 || file.size>10*1024*1024);
      documentFeedback(e.target,invalid);
      if(invalid){e.target.value='';return;}
      for(const file of files)documentFiles.set(file.name,file);
      state.documents=documents;
      const drop=e.target.closest('.apple-drop'),badge=drop.querySelector('.t-badge');
      drop.classList.add('filled');badge.querySelector('.t-badge-dot').textContent=String(documents.length);
      e.target.setAttribute('aria-label','Add Documents ('+documents.length+' added)');
      e.target.value='';
      badge.dataset.open='false';requestAnimationFrame(()=>requestAnimationFrame(()=>badge.dataset.open='true'));
    }
  });
  function syncKeys(){
    document.querySelectorAll("[data-key]").forEach(k=>{
      const key=k.dataset.key;
      const down=key==="modifier"?(pressed.has("MetaLeft")||pressed.has("MetaRight")):
        key==="control"?(pressed.has("ControlLeft")||pressed.has("ControlRight")):
        key==="alt"?(pressed.has("AltLeft")||pressed.has("AltRight")):
        key==="shift"?(pressed.has("ShiftLeft")||pressed.has("ShiftRight")):pressed.has(key);
      k.classList.toggle("pressed",down);
    });
  }
  function sendProduct(message) {
    if(window.taylosLocal)window.taylosLocal.send(message);
    else nativeFrame.contentWindow?.postMessage(message,location.origin);
  }
  function sendNative() {
    const r=stage.getBoundingClientRect();
    sendProduct({type:"taylos-preview-state",view:state.view,language:state.language,goal:goal(),goals:localizedGoals(),goalId:state.goal,platform:state.platform,showLabel:state.showLabel,history:state.history,visible:state.visible,launching:!!state.launching,reducedMotion:reduced.matches,direction:state.direction||1,stage:{x:r.x,y:r.y,width:r.width,height:r.height},stageArea:stage.offsetHeight+40,checkpoint:{view:state.view,goal:state.goal,customGoal:state.customGoal,fields:state.fields,website:state.website}});
  }
  let geometryFrame=0;
  function requestGeometry(){
    if(geometryFrame)return;
    geometryFrame=requestAnimationFrame(()=>{geometryFrame=0;sendNative();syncWebsiteSymbol();});
  }
  new ResizeObserver(sendNative).observe(stage);
  nativeFrame.addEventListener("load",sendNative);
  function receiveProduct(d) {
    if(d?.type==='onboarding-presented'){requestAnimationFrame(()=>{wrap.classList.remove('awaiting-presentation');intro();});return;}
    if(d?.type==='permissions-updated'){void refreshPermissions().then(()=>{if(state.view==='permissions'&&state.permission===2)go('transcript');});return;}
    if(d?.type==='language'){changeLanguage(d.language);return;}
    if(d?.type==='bar-introduction') {
      clearTimeout(spotlightWatchdog);
      const on=!!d.active&&!reduced.matches;
      barSpotlight.classList.toggle('introducing',on);
      if(!on)barSpotlight.style.setProperty('--bar-emphasis','0');
      // The reveal is 1.1s. Whatever the native side does, the overlay is gone by 1.6s.
      else spotlightWatchdog=setTimeout(()=>{barSpotlight.classList.remove('introducing');barSpotlight.style.setProperty('--bar-emphasis','0');},1600);
      return;
    }
    if(d?.type==='product-geometry'){
      const rects=d.rects||[];
      const bar=rects[0];
      if(bar){barSpotlight.style.setProperty('--bar-x',(bar.x+bar.width/2)+'px');barSpotlight.style.setProperty('--bar-y',(bar.y+bar.height/2)+'px');}
      barSpotlight.style.setProperty('--bar-emphasis',String(d.emphasis || 0));
      barSpotlight.classList.toggle('introducing',!!bar && d.emphasis>0 && !reduced.matches);
return;
    }
    if(d?.type==='shortcuts'){customShortcuts=d.shortcuts||{};controls.innerHTML=L(interaction());syncKeys();return;}
    if(d?.type==='finish-error'){toast(d.message || 'Could not finish setup. Please try again.');const finish=root.querySelector('[data-action=finish]');if(finish){finish.removeAttribute('aria-disabled');finish.textContent='Finish Setup';}return;}
    if(d?.type==="taylos-ready"){sendNative();return;}
    if(d?.type==="taylos-key"){
        document.dispatchEvent(new KeyboardEvent(d.kind,{code:d.code,key:d.key,metaKey:d.metaKey,ctrlKey:d.ctrlKey,altKey:d.altKey,shiftKey:d.shiftKey,repeat:d.repeat,bubbles:true}));return;
    }
    if(d?.type!=="taylos-action")return;
    if(d.action==="goal"&&goals[d.goal]){state.goal=d.goal;go("prepare");return;}
    if(d.action==="custom-goal"&&d.prompt?.trim()){state.goal="custom";state.customGoal=d.prompt.trim();go("prepare");return;}
    if(d.action==="post-action"){sendProduct({type:"taylos-post-action",prompt:d.prompt});return;}
    if(d.action==="show"){show();return;}
    if(d.action==="ask"){ask();return;}
    if(d.action==="listen"&&state.view==="prepare")goSkippingPermissions(state.permission===2?"transcript":"permissions",1);
    if(d.action==="insights"&&state.view==="transcript")go("insights");
    if(d.action==="transcript"&&state.view==="insights")go("transcript");
    if(d.action==="suggestion"){state.history=1;go("suggestion");}
    if(d.action==="stop")go("review");
    if(d.action==="done")go("personalize");
  }
  window.taylosLocal?.onMessage(receiveProduct);
  window.addEventListener("message",e=>{
    if(e.origin!==location.origin || e.source!==nativeFrame.contentWindow)return;
    const d=e.data;
    if(d?.type==="taylos-ready"){sendNative();return;}
    if(d?.type==="taylos-key"){
        document.dispatchEvent(new KeyboardEvent(d.kind,{code:d.code,key:d.key,metaKey:d.metaKey,ctrlKey:d.ctrlKey,altKey:d.altKey,shiftKey:d.shiftKey,repeat:d.repeat,bubbles:true}));return;
    }
    if(d?.type!=="taylos-action")return;
    if(d.action==="goal"&&goals[d.goal]){state.goal=d.goal;go("prepare");return;}
    if(d.action==="custom-goal"&&typeof d.prompt==="string"&&d.prompt.trim()){state.goal="custom";state.customGoal=d.prompt.trim();go("prepare");return;}
    if(d.action==="post-action"){nativeFrame.contentWindow.postMessage({type:"taylos-post-action",prompt:d.prompt},location.origin);return;}
    if(d.action==="settings")return;
    if(d.action==="show"){show();return;}
    if(d.action==="ask"){ask();return;}
    if(d.action==="listen"&&state.view==="prepare")goSkippingPermissions(state.permission===2?"transcript":"permissions",1);
    if(d.action==="insights"&&state.view==="transcript")go("insights");
    if(d.action==="transcript"&&state.view==="insights")go("transcript");
    if(d.action==="suggestion"){state.history=1;go("suggestion");}
    if(d.action==="stop")go("review");
    if(d.action==="done")go("personalize");
  });
  document.addEventListener("keydown",e=>{
    if(e.key==='Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && e.target.matches('.context-fields input[data-field]')) {
      e.preventDefault();
      const fields=Array.from(stageArt.querySelectorAll('.context-fields input[data-field]'));
      const next=fields[fields.indexOf(e.target)+1];
      save();
      if(next){next.focus();next.scrollIntoView({block:'nearest',behavior:reduced.matches?'instant':'smooth'});}
      else e.target.blur();
      return;
    }
    pressed.add(e.code);syncKeys();
    if(state.launching)return;
    const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if(typing)return;
    const modifier=isMac()?e.metaKey:e.ctrlKey;
    if(modifier&&e.code.startsWith('Arrow')){e.preventDefault();sendProduct({type:'taylos-move',code:e.code});return;}
    if(e.repeat)return;
    const matches=(type,fallback)=>{
      const saved=customShortcuts[shortcutIds[type]];if(!saved)return fallback;
      const parts=saved.toLowerCase().split('+'), key=parts.at(-1);
      const expected={metaKey:parts.some(p=>p==='cmd'||p==='command'),ctrlKey:parts.some(p=>p==='ctrl'||p==='control'),altKey:parts.some(p=>p==='alt'||p==='option'),shiftKey:parts.includes('shift')};
      if(Object.entries(expected).some(([k,v])=>Boolean(e[k])!==v))return false;
      return e.key.toLowerCase()===key || e.code.toLowerCase()===key || (key==='space'&&e.code==='Space') || (key==='return'&&e.code==='Enter');
    };
    if(matches('show',modifier&&(isMac()?e.code==='Backslash':e.code==='Space'))){e.preventDefault();show();}
    else if(matches('ask',modifier&&e.code==='Enter')){e.preventDefault();ask();}
    else if(state.view==='suggestion'&&matches('previous',e.altKey&&e.code==='KeyJ')){e.preventDefault();history(-1);}
    else if(state.view==='suggestion'&&matches('next',e.altKey&&e.code==='KeyK')){e.preventDefault();history(1);}
  });
  document.addEventListener("keyup",e=>{
    pressed.delete(e.code);
    if(["MetaLeft","MetaRight"].includes(e.code))pressed.clear();
    syncKeys();
  });
  window.addEventListener("blur",()=>{pressed.clear();syncKeys();});
  window.taylosLocal?.onAction(actionName=>{
    if(actionName==='show')show();
    if(actionName==='ask')ask();
    if(actionName==='previous')history(-1);
    if(actionName==='next')history(1);
  });
  if(new URLSearchParams(location.search).has('native')){
    document.documentElement.dataset.native='true';
    const setPointer=window.taylosLocal?.setPointerInside;
    if(setPointer){
      let inside=null;
      const test=(x,y)=>{
        const el=document.elementFromPoint(x,y);
        return !!el && !!el.closest('.window-wrap');
      };
      addEventListener('mousemove',e=>{
        const now=Boolean(cardDrag)||test(e.clientX,e.clientY);
        if(now!==inside){inside=now;setPointer(now);}
      },{passive:true});
      setPointer(false);
    }
  }
  async function detectLayout(){
    try{
      const layout=await navigator.keyboard?.getLayoutMap();
      if(!layout||manualLayout)return;
      const label=layout.get("Backslash");
      if(label){state.showLabel=label;state.layout=label==="#"?"de":label==="\\"?"us":"auto";controls.innerHTML=L(interaction());syncKeys();sendNative();}
    }catch{}
  }
  // ?view=<name> opens the preview straight on one state, for review capture.
  const startPlatform = new URLSearchParams(location.search).get('platform');
  if (startPlatform === 'win' || startPlatform === 'mac') { state.platform = startPlatform; manualLayout = true; }
  const startView = new URLSearchParams(location.search).get('view');
  if (startView && views.includes(startView)) {
    state.view = startView;
    if (startView !== 'welcome' && !state.goal) state.goal = 'needs';
    if (startView === 'permissions') state.permission = 0;
  }
  async function present() {
    wrap.classList.add('awaiting-presentation');
    document.documentElement.dataset.intro='true';
    if(window.taylosLocal){
      try {
        const initial=await window.taylosLocal.request('onboarding:initial-state');
        const checkpoint=initial?.checkpoint;
        if(checkpoint && views.includes(checkpoint.view)){
          Object.assign(state,{view:checkpoint.view,goal:checkpoint.goal||null,customGoal:checkpoint.customGoal||'',fields:checkpoint.fields||{},website:checkpoint.website||''});
        }
      } catch {}
    }
    render();detectLayout();void refreshPermissions();
    const icon=wrap.querySelector('.launch-base');
    await Promise.all([icon?.decode?.().catch(()=>{}),document.fonts.ready]);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(window.taylosLocal)window.taylosLocal.send({type:'onboarding-presentable'});
      else {wrap.classList.remove('awaiting-presentation');intro();}
    }));
  }
  void present();
})();
