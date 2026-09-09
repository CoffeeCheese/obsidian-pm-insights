import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
if (vault !== "dev-test") throw new Error("This verification writes a demo project and is restricted to dev-test.");
const evaluation = `(async () => {
  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin?.applyProjectLaunch) throw new Error("Load the current plugin build first");
  for (const leaf of app.workspace.getLeavesOfType("project-manager-insights-view")) {
    leaf.view.gateRiskModal?.close();
    leaf.view.gateEditor?.close();
    leaf.view.launchOverview?.close();
  }
  const protectedValue = localStorage.getItem("EmulateMobile");
  const results = [];
  const check = (name, value) => { results.push({ name, passed: Boolean(value) }); if (!value) throw new Error(name); };
  const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (read) => {
    for (let i=0;i<80;i++) { const result = await read(); if(result)return result; await wait(); }
    throw new Error("Timed out waiting for UI or catalog");
  };
  const date = offset => {
    const value=new Date();value.setHours(12,0,0,0);value.setDate(value.getDate()+offset);
    return value.getFullYear()+"-"+String(value.getMonth()+1).padStart(2,"0")+"-"+String(value.getDate()).padStart(2,"0");
  };
  const today=date(0), accepted=date(-2), correctedDate=date(-1);
  const projectId="pmi-launch-verification";
  const folder="Projects/PM Insights Launch Verification";
  const projectPath=folder+"/上线确认演示.md";
  const stages=plugin.settings.deliveryProgress.stages;
  if(stages.some(stage=>!stage.tags.length))throw new Error("The demo needs configured stage tags");
  for(const path of ["Projects",folder,folder+"/_tasks"]){if(!app.vault.getAbstractFileByPath(path))await app.vault.createFolder(path);}
  const taskIds=["pmi-launch-root",...stages.map(stage=>"pmi-launch-"+stage.id)];
  const note=(frontmatter,title)=>"---\\n"+Object.entries(frontmatter).map(([key,value])=>key+": "+JSON.stringify(value)).join("\\n")+"\\n---\\n\\n# "+title+"\\n\\nPM Insights 上线交互自动验证的虚构演示数据。\\n";
  const writeFixture=async(path,content)=>{
    const file=app.vault.getAbstractFileByPath(path);
    if(file){const old=await app.vault.read(file);if(!old.includes('PM Insights 上线交互自动验证'))throw new Error("Refusing to replace a non-fixture note");await app.vault.modify(file,content);}
    else await app.vault.create(path,content);
  };
  await writeFixture(projectPath,note({"pm-project":true,id:projectId,title:"上线确认演示",description:"PM Insights 上线交互自动验证",icon:"✅",taskIds,teamMembers:["演示负责人"],savedViews:[]},"上线确认演示"));
  const rootPath=folder+"/_tasks/pmi-launch-root.md";
  const common={"pm-task":true,projectId,status:"done",progress:100,assignees:["演示负责人"],priority:"normal",timeEstimate:2,timeLogs:[],completed:accepted,start:date(-6),due:accepted,customFields:{pmiLaunchFixture:true}};
  const rootContent=note({...common,id:taskIds[0],title:"上线演示需求",type:"task",parentId:null,subtaskIds:taskIds.slice(1),tags:[]},"上线演示需求");
  await writeFixture(rootPath,rootContent);
  for(const stage of stages)await writeFixture(folder+"/_tasks/pmi-launch-"+stage.id+".md",note({...common,id:"pmi-launch-"+stage.id,title:(stage.name||stage.id)+" 演示任务",type:"subtask",parentId:taskIds[0],subtaskIds:[],tags:[stage.tags[0]]},stage.id+" 演示任务"));
  await wait(400);
  let snapshot=await waitFor(async()=>{const s=await plugin.reconcileProjectManager();return s.projects.some(p=>p.id===projectId)&&s.tasks.filter(t=>t.projectId===projectId).length===taskIds.length?s:null;});
  const project=snapshot.projects.find(p=>p.id===projectId);
  const schedule={startDate:date(-7),stageGates:Object.fromEntries(stages.map(stage=>[stage.id,date(-3)])),acceptanceGate:accepted,launchDate:correctedDate,includeWeekends:true,countSameDayGateAsDay:false};
  const forecast={stageGates:schedule.stageGates,acceptanceGate:accepted,launchDate:date(1)};
  const plan={status:"confirmed",confirmed:forecast,confirmedRevisionId:"launch-demo-delay",revisions:[{id:"launch-demo-delay",kind:"confirmed",createdAt:date(-3)+"T10:00:00.000Z",reason:"演示环境发布窗口",forecast,stages:[],changes:{launch:"manual"}}]};
  await plugin.saveSettings(draft=>{draft.gateSchedules[projectId]=schedule;draft.gateDelays[projectId]=plan;delete draft.gateActuals[projectId];draft.selectedProjectIds=[projectId];draft.showDeliveryProgress=true;});
  await plugin.openInsights(projectPath);
  let leaf=app.workspace.getLeavesOfType("project-manager-insights-view")[0];
  if(leaf.view.host!==plugin){await leaf.setViewState({type:"empty"});await leaf.setViewState({type:"project-manager-insights-view",active:true});}
  await plugin.refreshInsights();
  const target=()=>plugin.settings.gateActuals[projectId];
  check("Acceptance reconciled from actual fixture notes",target()?.gates.acceptance?.open===false);
  const invalid=await plugin.applyProjectLaunch(projectId,{kind:"confirm",date:date(1)});
  check("Future date rejected",invalid.kind==="rejected"&&invalid.reason==="invalid-date");
  await plugin.saveSettings(draft=>{draft.gateDelays[projectId].draft=structuredClone(forecast);});
  const blocked=await plugin.applyProjectLaunch(projectId,{kind:"confirm",date:today});
  check("Pending delay draft rejected on submit",blocked.kind==="rejected"&&blocked.reason==="delay-draft-pending");
  await plugin.refreshInsights();
  const blockedEntry=document.querySelector('.pmi-project-scope-token[data-project-id="'+projectId+'"] .pmi-project-launch-status');
  check("Blocked project keeps visible entry",blockedEntry?.classList.contains('is-blocked'));
  blockedEntry.click();
  await waitFor(()=>document.querySelector('.pmi-launch-overview-modal .pmi-launch-resolve'));
  check("Blocked overview offers resolution",!document.querySelector('.pmi-launch-overview-modal .pmi-launch-confirm'));
  leaf.view.launchOverview.close();
  await plugin.saveSettings(draft=>{delete draft.gateDelays[projectId].draft;});
  await plugin.refreshInsights();
  const statusButton=()=>document.querySelector('.pmi-project-scope-token[data-project-id="'+projectId+'"] .pmi-project-launch-status');
  check("Project status shows ready entry",statusButton()?.classList.contains('is-ready'));
  const getLaunch=()=>document.querySelector('.pmi-launch-overview-modal [data-launch-project="'+projectId+'"]');
  document.querySelector('.pmi-gate-risk-summary').click();
  await waitFor(()=>document.querySelector('.pmi-launch-open'));
  document.querySelector('.pmi-launch-open').click();
  await waitFor(getLaunch);
  check("Launch node opens independent overview",!!getLaunch().querySelector('.pmi-launch-confirm'));
  leaf.view.launchOverview.close();
  statusButton().click();
  await waitFor(getLaunch);
  check("Project status opens same overview",!!getLaunch().querySelector('.pmi-launch-confirm'));
  getLaunch().querySelector('.pmi-launch-confirm').click();
  const form=await waitFor(()=>document.querySelector('.pmi-launch-confirm-modal form'));
  form.querySelector('input[type=date]').value=today;
  const originalSave=plugin.saveData.bind(plugin);
  const before=JSON.stringify(plugin.settings);
  plugin.saveData=async()=>{throw new Error("Simulated test write failure");};
  try {
    form.requestSubmit();
    await waitFor(()=>form.querySelector('.pmi-launch-error').textContent);
    check("Failed save preserves memory and input",JSON.stringify(plugin.settings)===before&&form.querySelector('input').value===today&&!target().launchDate);
  } finally {plugin.saveData=originalSave;}
  form.requestSubmit();
  form.requestSubmit();
  await waitFor(()=>!document.querySelector('.pmi-launch-confirm-modal'));
  await waitFor(()=>getLaunch()?.classList.contains('is-launched'));
  await wait(40);
  check("Confirmation saved once",target().launchDate===today&&target().events.filter(e=>e.kind==="launch").length===1);
  check("Delay completed",plugin.settings.gateDelays[projectId].status==="completed");
  check("Success animation and focus",getLaunch().classList.contains('is-celebrating')&&document.activeElement.classList.contains('pmi-launch-record'));
  check("Badge updated",!!document.querySelector('.pmi-project-scope-token[data-project-id="'+projectId+'"] .pmi-project-launch-badge'));
  const saved=await plugin.loadData();
  check("Launch persisted to disk",saved.gateActuals[projectId].launchDate===today);
  check("Management actions initially collapsed",!getLaunch().querySelector('.pmi-launch-management').open);
  getLaunch().querySelector('.pmi-launch-management summary').click();
  check("History has one dedicated entry",getLaunch().querySelectorAll('.pmi-launch-record').length===1&&getLaunch().querySelector('.pmi-launch-record').tagName==="SUMMARY");
  const managementButtons=[...getLaunch().querySelectorAll('.pmi-launch-management-items button')];
  check("Expanded management keeps compact aligned buttons",managementButtons.length===2&&managementButtons.every(button=>button.getBoundingClientRect().height<=48)&&Math.abs(managementButtons[0].getBoundingClientRect().top-managementButtons[1].getBoundingClientRect().top)<2);
  getLaunch().querySelector('.pmi-launch-correct').click();
  let edit=await waitFor(()=>document.querySelector('.pmi-launch-confirm-modal form'));
  edit.querySelector('input').value=correctedDate;edit.querySelector('textarea').value="核对部署记录，更正实际日期";edit.requestSubmit();
  await waitFor(()=>!document.querySelector('.pmi-launch-confirm-modal'));
  check("Date correction preserves original launch event",target().launchDate===correctedDate&&target().events.filter(e=>e.kind==="launch").length===1&&target().events.some(e=>e.kind==="launch-corrected"));
  check("Correction does not replay celebration",!getLaunch().classList.contains('is-celebrating'));
  getLaunch().querySelector('.pmi-launch-management summary').click();
  getLaunch().querySelector('.pmi-launch-revoke').click();
  edit=await waitFor(()=>document.querySelector('.pmi-launch-confirm-modal form'));
  edit.querySelector('textarea').value="验证误操作后的恢复能力";edit.requestSubmit();
  await waitFor(()=>!document.querySelector('.pmi-launch-confirm-modal'));
  check("Revocation restores delay plan and preserves history",!target().launchDate&&plugin.settings.gateDelays[projectId].status==="confirmed"&&target().events.some(e=>e.kind==="launch-revoked"));
  check("Revocation restores ready status entry",statusButton().classList.contains('is-ready'));
  const concurrent=await Promise.all([plugin.applyProjectLaunch(projectId,{kind:"confirm",date:today}),plugin.applyProjectLaunch(projectId,{kind:"confirm",date:today})]);
  check("Concurrent confirmations are idempotent",concurrent.filter(x=>x.kind==="changed").length===1&&concurrent.filter(x=>x.kind==="unchanged").length===1);
  try {
    const file=app.vault.getAbstractFileByPath(rootPath);
    await app.vault.modify(file,rootContent.replace('status: "done"','status: "in-progress"').replace('completed: '+JSON.stringify(accepted)+'\\n',''));
    await wait(300);await plugin.reconcileProjectManager();await plugin.refreshInsights();
    await waitFor(()=>getLaunch()?.querySelector('.pmi-launch-warning'));
    check("Reopened task retains launch fact and shows work",target().launchDate===today&&!!getLaunch().querySelector('.pmi-launch-warning'));
  } finally {
    await app.vault.modify(app.vault.getAbstractFileByPath(rootPath),rootContent);
    await wait(300);await plugin.reconcileProjectManager();await plugin.refreshInsights();
  }
  const sameDate=await plugin.applyProjectLaunch(projectId,{kind:"confirm",date:today});
  check("Reloading state does not produce another event",sameDate.kind==="unchanged"&&!getLaunch().classList.contains('is-celebrating'));
  leaf.view.launchOverview.close();
  document.querySelector('.pmi-project-scope-token[data-project-id="'+projectId+'"] .pmi-project-scope-gates').click();
  leaf.view.gateEditor.showTab("delay");
  check("Delay tab has no launch actions",!leaf.view.gateEditor.contentEl.querySelector('.pmi-launch-panel, .pmi-launch-confirm, .pmi-launch-correct, .pmi-launch-revoke'));
  check("Delay tab shows dated completion",leaf.view.gateEditor.contentEl.textContent.includes(today));
  leaf.view.gateEditor.close();
  await plugin.saveSettings(draft=>{delete draft.gateSchedules[projectId];});
  await plugin.refreshInsights();
  // Existing launch facts remain visible even if schedule configuration is missing.
  check("Launched entry survives missing schedule",statusButton().classList.contains('is-launched'));
  await plugin.saveSettings(draft=>{draft.gateSchedules[projectId]=schedule;});
  await plugin.refreshInsights();
  statusButton().click();
  await waitFor(getLaunch);
  check("Protected mobile state unchanged",localStorage.getItem("EmulateMobile")===protectedValue);
  return JSON.stringify({vault:app.vault.getName(),projectId,projectPath,today,protectedValue,results});
})()`;
const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], { encoding: "utf8", timeout: 90000 });
if (result.error) throw result.error;
const output = result.stdout.trim();
if (result.status !== 0 || !output.startsWith("=> {")) throw new Error(output || result.stderr);
const report = JSON.parse(output.slice(3));
console.log(JSON.stringify(report, null, 2));
