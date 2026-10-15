import {readFile,lstat,mkdir,writeFile,unlink} from 'node:fs/promises';
import {arch,totalmem,cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {command,digest} from './storage.js';
import {normalizeArchitecture} from '../platform.mjs';
export const KUBERNETES_TYPES=['kubernetes.install','kubernetes.service','kubernetes.scale','kubernetes.restart'];
const release=JSON.parse(await readFile(new URL('../../config/kubernetes-release.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../../',import.meta.url));
const validName=value=>typeof value==='string'&&/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(value);
export class KubernetesAdapter{
 constructor({run=command,dir='/var/lib/lightnas-storage',architecture=normalizeArchitecture(arch()),memoryMiB=Math.floor(totalmem()/1024**2),cores=cpus().length,exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}}={}){Object.assign(this,{run,dir,architecture,memoryMiB,cores,exists});}
 async checked(args){const result=await this.run('/usr/local/bin/k3s',['kubectl','--request-timeout=10s',...args],20000);if(!result.ok)throw Error('Kubernetes request failed. Check service health, namespace and access permissions.');return JSON.parse(result.stdout||'{}');}
 async context(){const state={installed:await this.exists('/usr/local/bin/k3s'),configExists:await this.exists('/etc/rancher/k3s/config.yaml'),serviceExists:await this.exists('/etc/systemd/system/k3s.service'),dataExists:await this.exists('/var/lib/rancher/k3s')};let role=null;if(state.serviceExists)try{const unit=await readFile('/etc/systemd/system/k3s.service','utf8');role=/ExecStart=.*\bk3s agent\b/.test(unit)?'agent':/ExecStart=.*\bk3s server\b/.test(unit)?'server':null;}catch{}return {...state,role};}

 async inventory(){
  const state=await this.context(),supported=!!release.architectures[this.architecture];const result={...state,architecture:this.architecture,supported,version:release.version,memoryMiB:this.memoryMiB,cores:this.cores,serverMinimumMiB:4096,agentMinimumMiB:3072,running:false,nodes:[],deployments:[],pods:[],services:[]};if(!state.installed)return result;
  const version=await this.run('/usr/local/bin/k3s',['--version']);result.installedVersion=version.ok?version.stdout.match(/v\d+\.\d+\.\d+\+k3s\d+/)?.[0]||null:null;
  result.running=(await this.run('/usr/bin/systemctl',['is-active','k3s.service'])).ok;if(!result.running)return result;
  if(state.role==='agent')return {...result,agentOnly:true,notice:'Worker service status is shown here. Manage cluster workloads from the Kubernetes server.'};
  try{
   const [nodes,deployments,pods,services]=await Promise.all([this.checked(['get','nodes','-o','json']),this.checked(['get','deployments','--all-namespaces','-o','json']),this.checked(['get','pods','--all-namespaces','-o','json']),this.checked(['get','services','--all-namespaces','-o','json'])]);
   result.nodes=(nodes.items||[]).map(n=>({name:n.metadata.name,architecture:n.status?.nodeInfo?.architecture,version:n.status?.nodeInfo?.kubeletVersion,ready:n.status?.conditions?.some(c=>c.type==='Ready'&&c.status==='True')}));
   result.deployments=(deployments.items||[]).map(d=>({name:d.metadata.name,namespace:d.metadata.namespace,replicas:d.spec?.replicas||0,ready:d.status?.readyReplicas||0}));
   result.pods=(pods.items||[]).map(p=>({name:p.metadata.name,namespace:p.metadata.namespace,node:p.spec?.nodeName,phase:p.status?.phase,restarts:(p.status?.containerStatuses||[]).reduce((sum,c)=>sum+(c.restartCount||0),0)}));
   result.services=(services.items||[]).map(s=>({name:s.metadata.name,namespace:s.metadata.namespace,type:s.spec?.type,clusterIP:s.spec?.clusterIP,ports:(s.spec?.ports||[]).map(p=>({port:p.port,nodePort:p.nodePort,protocol:p.protocol}))}));
  }catch(error){result.error=error.message;result.controlPlaneAvailable=false;}return result;
 }
 async plan(input){
  const {type}=input;if(!KUBERNETES_TYPES.includes(type))throw Error('Unsupported Kubernetes operation');const before=await this.context();let after,commands=[],identity={...before};
  if(type==='kubernetes.install'){
   const allowed=['type','mode','bindAddress','clusterCidr','serviceCidr','server','private'];if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unexpected Kubernetes install fields');
   if(Object.values(before).some(Boolean))throw Error('An existing Kubernetes installation/configuration will not be overwritten');
   if(!release.architectures[this.architecture])throw Error('No pinned K3s runtime is available for '+this.architecture);
   const config={mode:input.mode||'server',...(input.mode==='agent'?{server:input.server,token:input.private?.token}:{bindAddress:input.bindAddress||'0.0.0.0',clusterCidr:input.clusterCidr||'10.242.0.0/16',serviceCidr:input.serviceCidr||'10.243.0.0/16'})};
   const validation=await this.run('/usr/bin/python3',['-c','import importlib.util,json,sys; s=importlib.util.spec_from_file_location("k",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.validate(json.loads(sys.argv[2]),sys.argv[3],int(sys.argv[4]),int(sys.argv[5]))',join(root,'scripts/install-kubernetes.py'),JSON.stringify({...config,...(config.token?{token:'K10'+'a'.repeat(64)+'::validation-placeholder'}:{})}),this.architecture,String(this.memoryMiB),String(this.cores)]);
   if(!validation.ok)throw Error('Kubernetes prerequisites failed: '+validation.stderr.split('\n').filter(Boolean).at(-1));
   // Validate secure join token without putting it into a child-process argv.
   if(config.mode==='agent'&&!/^K10[0-9a-f]{64}::[^\s\0]{1,4096}$/.test(config.token||''))throw Error('Provide the secure K10 join token with server CA hash');
   if(!await this.exists('/run/systemd/system')||!await this.exists('/sys/fs/cgroup'))throw Error('A systemd host and usable cgroups are required');
   after={mode:config.mode,version:release.version,architecture:this.architecture,binarySha256:release.architectures[this.architecture].sha256,bindAddress:config.bindAddress,clusterCidr:config.clusterCidr,serviceCidr:config.serviceCidr,server:config.server,firewallChanged:false};
   commands=[{bin:'/usr/bin/systemd-run',args:['--wait','--pipe','--collect','/usr/bin/python3',join(root,'scripts/install-kubernetes.py'),'<root-private-install-request>']}];
  }else if(type==='kubernetes.service'){
   if(Object.keys(input).some(key=>!['type','action'].includes(key))||!['start','stop','restart'].includes(input.action)||!before.installed||!before.serviceExists)throw Error('Choose start, stop or restart for an installed K3s service');
   identity.active=(await this.run('/usr/bin/systemctl',['is-active','k3s.service'])).ok;commands=[{bin:'/usr/bin/systemctl',args:[input.action,'k3s.service']}];after={action:input.action};
  }else{
   if(Object.keys(input).some(key=>!['type','namespace','name','replicas','restartStamp'].includes(key))||!validName(input.namespace)||!validName(input.name))throw Error('Choose an existing deployment and namespace');
   const deployment=await this.checked(['get','deployment',input.name,'-n',input.namespace,'-o','json']);identity={uid:deployment.metadata.uid,resourceVersion:deployment.metadata.resourceVersion,namespace:input.namespace,name:input.name,replicas:deployment.spec.replicas||0};
   if(type==='kubernetes.scale'){const replicas=Number(input.replicas);if(!Number.isInteger(replicas)||replicas<0||replicas>100)throw Error('Replicas must be 0–100');commands=[{bin:'/usr/local/bin/k3s',args:['kubectl','--request-timeout=30s','scale','deployment',input.name,'-n',input.namespace,'--replicas='+replicas,'--current-replicas='+identity.replicas,'--resource-version='+identity.resourceVersion]}];after={namespace:input.namespace,name:input.name,replicas};}
   else{if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.restartStamp||''))throw Error('A prepared restart timestamp is required');const patch={metadata:{uid:identity.uid,resourceVersion:identity.resourceVersion},spec:{template:{metadata:{annotations:{'kubectl.kubernetes.io/restartedAt':input.restartStamp}}}}};commands=[{bin:'/usr/local/bin/k3s',args:['kubectl','--request-timeout=30s','patch','deployment',input.name,'-n',input.namespace,'--type=merge','-p',JSON.stringify(patch)]}];after={namespace:input.namespace,name:input.name,restartStamp:input.restartStamp};}
  }
  return {type,input,identity,before,after,commands,affectedServices:['k3s.service'],dataErased:false,permissionChanges:type==='kubernetes.install',confirmation:type==='kubernetes.service'&&input.action==='stop'?'STOP KUBERNETES':undefined,warning:type==='kubernetes.install'?'Installs the pinned native Kubernetes binary and a root service. Creates pod/service networks. Existing firewall policy is preserved; review host routes and permit cluster traffic explicitly when required.':'Changes the specified Kubernetes service or deployment; workloads can be interrupted.',rollback:'No automatic cluster or workload rollback. Existing cluster data is preserved. Inspect the service and deployment after a failure.'};
 }
 prepare(input){return input.type==='kubernetes.restart'?{...input,restartStamp:input.restartStamp||new Date().toISOString()}:input;}
 async validate(impact){if(digest(await this.plan(impact.input))!==digest(impact))throw Error('Kubernetes state changed; request another preview');}
 async apply(impact){
  if(impact.type==='kubernetes.install'){
   await mkdir(this.dir,{recursive:true,mode:0o700});const path=join(this.dir,'kubernetes-'+randomUUID()+'.json'),input=impact.input,config=input.mode==='agent'?{mode:'agent',server:input.server,token:input.private.token}:{mode:'server',bindAddress:input.bindAddress||'0.0.0.0',clusterCidr:input.clusterCidr||'10.242.0.0/16',serviceCidr:input.serviceCidr||'10.243.0.0/16'};
   await writeFile(path,JSON.stringify(config),{mode:0o600,flag:'wx'});try{const result=await this.run('/usr/bin/systemd-run',['--wait','--pipe','--collect','--unit=lightnas-kubernetes-install-'+randomUUID(),'/usr/bin/python3',join(root,'scripts/install-kubernetes.py'),path],900000);if(!result.ok)throw Error('Kubernetes installation failed; inspect the install unit and retained partial configuration before retrying.');}finally{await unlink(path);}
  }else for(const c of impact.commands){const result=await this.run(c.bin,c.args,180000);if(!result.ok)throw Error('Kubernetes operation failed; inspect the service/deployment.');}
  if(impact.type==='kubernetes.scale'){const actual=await this.checked(['get','deployment',impact.input.name,'-n',impact.input.namespace,'-o','json']);if(actual.metadata.uid!==impact.identity.uid||actual.spec.replicas!==impact.after.replicas)throw Error('Deployment scale result could not be verified');}
  if(impact.type==='kubernetes.restart'){const actual=await this.checked(['get','deployment',impact.input.name,'-n',impact.input.namespace,'-o','json']);if(actual.metadata.uid!==impact.identity.uid||actual.spec?.template?.metadata?.annotations?.['kubectl.kubernetes.io/restartedAt']!==impact.after.restartStamp)throw Error('Deployment restart result could not be verified');}
  if(['kubernetes.install','kubernetes.service'].includes(impact.type)){const active=(await this.run('/usr/bin/systemctl',['is-active','k3s.service'])).ok;if(active!==(impact.after.action!=='stop'))throw Error('Kubernetes service state could not be verified');}
  return impact.after;
 }
}
