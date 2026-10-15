import {KubernetesAdapter,KUBERNETES_TYPES} from './kubernetes.js';
import {DatasetAdapter,DATASET_TYPES} from './datasets.js';
import {CertificateAdapter,CERTIFICATE_TYPES} from './certificates.js';
import {ProtectionAdapter,PROTECTION_TYPES,nextRun} from './protection.js';
export const FEATURE_TYPES=[...DATASET_TYPES,...CERTIFICATE_TYPES,...PROTECTION_TYPES,...KUBERNETES_TYPES];
export class FeatureAdapter{
 constructor({dir='/var/lib/lightnas-storage',run,datasets,certificates,protection,kubernetes}={}){this.kubernetes=kubernetes||new KubernetesAdapter({dir,run});this.datasets=datasets||new DatasetAdapter({run});this.certificates=certificates||new CertificateAdapter({dir,run});this.protection=protection||new ProtectionAdapter({dir,datasets:this.datasets,run});}
 adapter(type){if(KUBERNETES_TYPES.includes(type))return this.kubernetes;if(DATASET_TYPES.includes(type))return this.datasets;if(CERTIFICATE_TYPES.includes(type))return this.certificates;if(PROTECTION_TYPES.includes(type))return this.protection;throw Error('Unsupported feature operation');}
 prepare(input){return this.adapter(input.type).prepare?.(input)||input;}
 async init(){await this.certificates.init();await this.protection.init();}
 async protectionInventory(){const protection=await this.protection.inventory();for(const task of protection.tasks){const job=this.ops?.jobs.get(task.runtime.lastJob);if(job)task.runtime={...task.runtime,status:job.status,progress:job.progress,logs:job.logs.slice(-5)};}return protection;}
 async inventory(){const protection=await this.protectionInventory();return {zfs:await this.datasets.inventory(),protection,certificates:await this.certificates.inventory()};}
 async datasetDetail(name){const detail=await this.datasets.detail(name);const protection=await this.protection.registry();const shares=await this.shareProvider?.()||[];const within=path=>path===detail.mountpoint||String(path||'').startsWith(detail.mountpoint+'/');detail.usage={shares:shares.filter(s=>within(s.path)).map(s=>({name:s.name,protocol:s.protocol,path:s.path})),protectionTasks:protection.tasks.filter(t=>t.source===name||within(t.source)).map(t=>({id:t.id,kind:t.kind})),applications:[],applicationDiscoveryAvailable:false};
  const run=this.datasets.run;const containers=await run('/usr/bin/docker',['ps','-aq']);if(containers.ok){const ids=containers.stdout.trim().split('\n').filter(v=>/^[a-f0-9]{12,64}$/.test(v)).slice(0,128);detail.usage.applicationDiscoveryAvailable=true;if(ids.length){const inspect=await run('/usr/bin/docker',['inspect','--format','{{json .Name}}\t{{json .Mounts}}',...ids]);if(inspect.ok)for(const line of inspect.stdout.trim().split('\n'))try{const [rawName,rawMounts]=line.split('\t');const mounts=JSON.parse(rawMounts).filter(m=>within(m.Source));if(mounts.length)detail.usage.applications.push({name:JSON.parse(rawName).replace(/^\//,''),mounts:mounts.map(m=>({source:m.Source,destination:m.Destination}))});}catch{detail.usage.applicationDiscoveryAvailable=false;}else detail.usage.applicationDiscoveryAvailable=false;}}
  return detail;
 }
 plan(input){return this.adapter(input.type).plan(input);}
 validate(impact){return this.adapter(impact.type).validate(impact);}
 apply(impact){return this.adapter(impact.type).apply(impact);}
 startScheduler(ops){
  this.ops=ops;
  let ticking=false,renewAt=Date.now()+60000;
  const tick=async()=>{
   if(ticking||ops.busy)return;ticking=true;
   try{
    const now=new Date();const registry=await this.protection.registry(),runtime=await this.protection.runtime();
    for(const task of registry.tasks.filter(t=>t.enabled&&t.schedule.frequency!=='on-demand')){
     if(ops.busy)break;const state=runtime[task.id]||{};
     if(!state.nextRun){await this.protection.record(task.id,{nextRun:nextRun(task.schedule,now)});continue;}
     if(Date.parse(state.nextRun)>now.getTime())continue;
     // Claim one run durably before execution; never replay a missed/active run on restart.
     await this.protection.record(task.id,{nextRun:nextRun(task.schedule,now),lastRun:now.toISOString(),status:'starting'});
     try{const preview=await ops.preview({type:'protection.run',id:task.id});await ops.approve(preview.id,preview.approvalHash,preview.impact?.confirmation);await this.protection.record(task.id,{lastJob:preview.id,status:'queued'});}catch(error){await this.protection.record(task.id,{status:'failed',error:error.message});}
    }
    if(!ops.busy&&Date.now()>=renewAt){renewAt=Date.now()+12*3600000;const registry=await this.certificates.registry();if(registry.certificates.some(c=>c.acme)){ops.busy=true;try{await this.certificates.renew();}catch(error){console.error('LightNAS ACME renewal: '+error.message);}finally{ops.busy=false;}}}
   }catch(error){console.error('LightNAS protection scheduler: '+error.message);}finally{ticking=false;}
  };
  const timer=setInterval(tick,30000);timer.unref();return {tick,stop:()=>clearInterval(timer)};
 }
}
