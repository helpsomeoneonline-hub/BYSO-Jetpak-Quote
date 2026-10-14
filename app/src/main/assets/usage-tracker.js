/* BYSO private, on-device usability logger. Records interactions, NOT field values. */
(() => {
  "use strict";
  const STORAGE="byso_usage_events_v1";
  const CONSENT="byso_usage_opt_in_v1";
  const LIMIT=400;
  const SAFE_CONTROLS=new Set([
    "weight","weightUnit","onlineCost","costUnit","streetRate","customDays","limitedDeal",
    "includeDuty","includeVat","includeOpt","usdBtn","ttdBtn","copyBtn","resetBtn",
    "calculateBtn","usageToggle","usageShareBtn","usageCopyBtn","usageClearBtn"
  ]);
  const $=id=>document.getElementById(id);
  let enabled=false, events=[], lastScrollY=window.scrollY, lastScrollTime=0, lastScrollDirection="";
  let focusAt=0, focusTarget="", lastCalculateAt=Date.now();
  try {
    enabled=localStorage.getItem(CONSENT)==="true";
    const saved=JSON.parse(localStorage.getItem(STORAGE)||"[]");
    if(Array.isArray(saved)) events=saved.slice(-LIMIT).filter(e=>e&&typeof e==="object");
  } catch (_) { events=[]; enabled=false; }
  function save() {
    try {localStorage.setItem(STORAGE,JSON.stringify(events));} catch (_) {}
  }
  function safeTarget(element) {
    if(!element) return "unknown";
    const el=element.closest("button,input,select,[data-insight-section]");
    if(!el) return "page";
    if(el.id && SAFE_CONTROLS.has(el.id)) return el.id;
    if(el.dataset && el.dataset.days && ["3","12","custom"].includes(el.dataset.days)) return "delivery_"+el.dataset.days;
    if(el.dataset && el.dataset.duty && ["20","30"].includes(el.dataset.duty)) return "duty_"+el.dataset.duty;
    const section=el.closest("[data-insight-section]");
    return section ? section.dataset.insightSection : "page";
  }
  function record(type,target,detail) {
    if(!enabled) return;
    const evt={at:new Date().toISOString(),type,target};
    if(detail!==undefined) evt.detail=detail;
    events.push(evt);
    if(events.length>LIMIT) events.splice(0,events.length-LIMIT);
    save(); render();
  }
  function digest() {
    const counts={}, targets={};
    for(const e of events){
      counts[e.type]=(counts[e.type]||0)+1;
      if(e.type==="tap") targets[e.target]=(targets[e.target]||0)+1;
    }
    return {counts,frequentlyUsed:Object.entries(targets).sort((a,b)=>b[1]-a[1]).slice(0,7)
      .map(([target,count])=>({target,count}))};
  }
  function render() {
    $("usageToggle").checked=enabled;
    $("usageStatus").textContent=enabled?"Recording locally":"Off";
    const count=events.length;
    const {counts,frequentlyUsed}=digest();
    const top=frequentlyUsed.slice(0,3).map(x=>x.target+" ("+x.count+")").join(", ");
    $("usageSummary").textContent=!count
      ? "No usage recorded yet."
      : count+" recorded interactions · "+(counts.scroll||0)+" scrolls · "+(counts.calculate||0)+
        " estimate views"+(top?" · Most-used controls: "+top:"");
    $("usageShareBtn").disabled=!count;
    $("usageCopyBtn").disabled=!count;
    $("usageClearBtn").disabled=!count;
  }
  function report() {
    const payload={
      report:"BYSO JetPak Quote — local usability interactions",
      explanation:"Anonymized control names, navigation, scroll depth and timing; no typed field values.",
      createdAt:new Date().toISOString(),
      storedEvents:events.length,
      ...digest(),
      events:events
    };
    return JSON.stringify(payload,null,2);
  }
  $("usageToggle").addEventListener("change",e=>{
    enabled=e.target.checked;
    try {localStorage.setItem(CONSENT,String(enabled));} catch (_) {}
    record("recording_enabled","insights"); render();
  });
  $("usageClearBtn").addEventListener("click",()=>{
    if(!confirm("Clear all locally recorded usage history?")) return;
    events=[];save();render();
  });
  $("usageCopyBtn").addEventListener("click",()=>{
    if(!events.length) return;
    const text=report();
    if(window.AndroidBridge&&AndroidBridge.copyText) {
      AndroidBridge.copyText(text);
    } else if(navigator.clipboard&&navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(()=>alert("Copy is unavailable on this device."));
    }
  });
  $("usageShareBtn").addEventListener("click",()=>{
    if(!events.length) return;
    const text=report();
    if(window.AndroidBridge&&AndroidBridge.shareUsageReport){
      AndroidBridge.shareUsageReport(text);
    } else if(navigator.share) {
      navigator.share({title:"JetPak Usability Report",text}).catch(()=>{});
    } else {
      alert("Use Copy report to share your usage log.");
    }
  });
  document.addEventListener("click",e=>{
    const item=e.target.closest("button");
    if(!item || item.closest("#usagePanel")) return;
    const target=safeTarget(item);
    record("tap",target);
    if(target==="calculateBtn"){
      const seconds=Math.min(3600,Math.round((Date.now()-lastCalculateAt)/1000));
      record("calculate",target,{secondsSinceLastView:seconds});
      lastCalculateAt=Date.now();
    }
  },true);
  document.addEventListener("focusin",e=>{
    if(!e.target.matches("input:not([type=checkbox]),select") || e.target.closest("#usagePanel")) return;
    focusTarget=safeTarget(e.target);focusAt=Date.now();
    record("focus",focusTarget);
  },true);
  document.addEventListener("focusout",e=>{
    if(!focusAt || safeTarget(e.target)!==focusTarget) return;
    record("field_time",focusTarget,{seconds:Math.min(300,Math.round((Date.now()-focusAt)/1000))});
    focusAt=0;focusTarget="";
  },true);
  document.addEventListener("change",e=>{
    if(e.target.closest("#usagePanel")) return;
    if(e.target.matches("input,select")) record("change",safeTarget(e.target));
  },true);
  document.addEventListener("keydown",e=>{
    if(e.target.matches("input:not([type=checkbox])") && (e.key==="Backspace" || e.key==="Delete")){
      record("correction",safeTarget(e.target));
    }
  },true);
  window.addEventListener("scroll",()=>{
    if(!enabled) return;
    const now=Date.now(), y=window.scrollY;
    const delta=y-lastScrollY, direction=delta>0?"down":"up";
    if(Math.abs(delta)<28) return;
    if(now-lastScrollTime<800 && direction===lastScrollDirection) return;
    const maxScroll=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    const depth=Math.min(100,Math.round(y/maxScroll*100/10)*10);
    const mid=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2);
    const section=mid&&mid.closest("[data-insight-section]");
    record("scroll",section?section.dataset.insightSection:"page",{direction,depthPercent:depth});
    lastScrollTime=now;lastScrollDirection=direction;lastScrollY=y;
  },{passive:true});
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden) record("background","app");
    else record("foreground","app");
  });
  record("screen_open","app");
  render();
})();
