#!/usr/bin/env node
/**
 * Bounded, read-only LightNAS HTTP/TLS stress runner.
 * No credentials, POST/PUT/PATCH/DELETE, host commands, or storage mutations.
 * This probes the *running appliance*, not a full install/restore qualification.
 */
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';

const DEFAULTS = Object.freeze({
  url:'https://127.0.0.1:3080', seconds:45, rps:2, concurrency:4, timeoutMs:5000, ackImpact:false
});

export const probes = Object.freeze([
  {path:'/api/status', expected:200, type:'status'},
  {path:'/api/branding', expected:200, type:'branding'},
  {path:'/', expected:200, type:'html'},
  {path:'/api/profile', expected:401, type:'protected'},
  {path:'/api/network', expected:401, type:'protected'},
  {path:'/api/storage', expected:401, type:'protected'},
  {path:'/api/files?all=1', expected:401, type:'protected'}
]);

export function isPrivateAddress(host) {
  const h=String(host).replace(/^\[|\]$/g,'').toLowerCase();
  if (h==='localhost'||h==='::1') return true;
  const kind=isIP(h);
  if (kind===6) return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(h);
  if (kind!==4) return false;
  const [a,b]=h.split('.').map(Number);
  return a===10 || a===127 || a===169&&b===254 ||
    a===172&&b>=16&&b<=31 || a===192&&b===168 ||
    a===100&&b>=64&&b<=127;
}

export function parseOptions(args) {
  const options={...DEFAULTS};
  const mapping={'--url':'url','--seconds':'seconds','--rps':'rps',
    '--concurrency':'concurrency','--timeout-ms':'timeoutMs'};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(key==='--help'||key==='-h') return {help:true};
    if(key==='--ack-impact'){options.ackImpact=true;continue;}
    if(!(key in mapping)||i+1===args.length) throw Error('Unknown or incomplete argument: '+key);
    const value=args[++i];
    options[mapping[key]]=key==='--url'?value:Number(value);
  }
  let parsed;
  try{parsed=new URL(options.url);}catch{throw Error('Specify a valid HTTPS URL on port 3080');}
  if(parsed.protocol!=='https:'||parsed.port!=='3080'||
     parsed.username||parsed.password||parsed.pathname!=='/'||
     parsed.search||parsed.hash||!isPrivateAddress(parsed.hostname))
    throw Error('Only a private/local HTTPS IP or localhost on port 3080 is supported (no credentials or paths)');
  for(const [key,min,max] of [['seconds',5,300],['rps',1,12],
    ['concurrency',1,16],['timeoutMs',1000,15000]]){
    if(!Number.isInteger(options[key])||options[key]<min||options[key]>max)
      throw Error(key+' must be an integer between '+min+' and '+max);
  }
  if((options.rps>3||options.seconds>120)&&!options.ackImpact)
    throw Error('High load/long duration needs --ack-impact; use a dedicated test appliance or maintenance window');
  options.url=parsed.origin;
  return options;
}

export function assess(probe,status,body='',headers=new Headers()) {
  if(status===429){
    return {kind:'throttled',ok:headers.has('retry-after'),reason:headers.has('retry-after')?'Rate limit correctly enforced':'429 missing Retry-After'};
  }
  if(status!==probe.expected) return {kind:'unexpected',ok:false,reason:probe.path+' returned '+status+' (expected '+probe.expected+')'};
  if(probe.type==='status'){
    try{
      const value=JSON.parse(body);
      if(typeof value.version!=='string'||value.setupRequired!==false)
        return {kind:'unexpected',ok:false,reason:'Server not configured or status JSON invalid'};
    }catch{return {kind:'unexpected',ok:false,reason:'Malformed status JSON'};}
  }
  if(probe.type==='branding'){
    try{
      if(typeof JSON.parse(body).brandName!=='string')
        return {kind:'unexpected',ok:false,reason:'Malformed branding JSON'};
    }catch{return {kind:'unexpected',ok:false,reason:'Malformed branding JSON'};}
  }
  if(probe.type==='html'&&!body.toLowerCase().includes('<html'))
    return {kind:'unexpected',ok:false,reason:'Root did not return HTML'};
  return {kind:'expected',ok:true};
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(items,p)=>items.length?Number(items[Math.min(items.length-1,Math.ceil(items.length*p)-1)].toFixed(1)):null;
const standardRequest=async (base,probe,timeoutMs)=>{
  const begin=performance.now();
  const response=await fetch(base+probe.path,{
    method:'GET',redirect:'manual',
    headers:{'X-LightNAS-Request':'1','Cache-Control':'no-cache'},
    signal:AbortSignal.timeout(timeoutMs)
  });
  const body=await response.text();
  return {status:response.status,body,headers:response.headers,ms:performance.now()-begin};
};

export async function runStress(options,{request=standardRequest,logger=console}={}) {
  const report={
    url:options.url, mode:'read-only', secondsRequested:options.seconds,
    rpsRequested:options.rps, concurrency:options.concurrency,
    startedAt:new Date().toISOString(), requests:0, ok:0,
    throttled:0, failures:0, transportErrors:0, statuses:{}, paths:{}, verifiedPaths:{},
    samples:[], problems:[], aborted:false
  };
  const maxProblems=20;
  const inflight=new Set();
  const addProblem=message=>{
    if(report.problems.length<maxProblems) report.problems.push(String(message).slice(0,200));
  };
  const execute=async(probe)=>{
    const t=performance.now();
    try{
      const result=await request(options.url,probe,options.timeoutMs);
      const ms=Number.isFinite(result.ms)?result.ms:performance.now()-t;
      const assessment=assess(probe,result.status,result.body,result.headers);
      report.samples.push(ms);
      report.statuses[result.status]=(report.statuses[result.status]||0)+1;
      if(assessment.ok){
        if(assessment.kind==='throttled')report.throttled++;
        else {
          report.ok++;
          report.verifiedPaths[probe.path]=(report.verifiedPaths[probe.path]||0)+1;
        }
      }else{report.failures++;addProblem(assessment.reason);}
    }catch(error){
      report.transportErrors++;
      addProblem(probe.path+': '+(error?.message||'transport error'));
    }
    report.requests++;
    report.paths[probe.path]=(report.paths[probe.path]||0)+1;
  };

  // Preflight is always first, no uncontrolled traffic against an unconfigured
  // appliance or unverified TLS endpoint.
  let initial;
  try{initial=await request(options.url,probes[0],options.timeoutMs);}
  catch(error){throw Error('HTTPS preflight failed: '+error.message+
    '. For appliance self-signed TLS use NODE_EXTRA_CA_CERTS=/etc/lightnas/tls/nas.crt (do not disable TLS verification).');}
  const verified=assess(probes[0],initial.status,initial.body,initial.headers);
  if(!verified.ok||verified.kind!=='expected') throw Error('Preflight failed: '+verified.reason);
  const started=performance.now();
  const end=started+options.seconds*1000;
  const interval=1000/options.rps;
  let index=0,nextTick=started;
  let stopped=false;
  const stop=()=>{stopped=true;};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  try{
    while(!stopped&&performance.now()<end){
      const now=performance.now();
      if(now<nextTick){await sleep(Math.min(nextTick-now,200));continue;}
      // Never create an unbounded queue if the appliance becomes slow.
      if(inflight.size<options.concurrency){
        const probe=probes[index++%probes.length];
        const task=execute(probe);
        inflight.add(task);
        task.finally(()=>inflight.delete(task));
      }
      nextTick=Math.max(nextTick+interval,performance.now());
      if(report.transportErrors>=5||report.failures>=10){stopped=true;addProblem('Stopped early after repeated failures');}
    }
    await Promise.allSettled([...inflight]);
  }finally{
    process.removeListener('SIGINT',stop);
    process.removeListener('SIGTERM',stop);
  }
  // A 429 is evidence of throttling, not evidence that a protected route
  // rejects unauthenticated access. Never report a passing security probe
  // unless each route returned its expected, unthrottled status at least once.
  for(const probe of probes){
    if(!report.verifiedPaths[probe.path]){
      report.failures++;
      addProblem('No verified HTTP '+probe.expected+' response for '+probe.path+
        '; throttling or insufficient coverage cannot establish the expected behavior');
    }
  }
  report.aborted=stopped;
  report.durationSeconds=Number(((performance.now()-started)/1000).toFixed(2));
  report.samples.sort((a,b)=>a-b);
  report.latencyMs={
    p50:percentile(report.samples,0.50),
    p95:percentile(report.samples,0.95),
    p99:percentile(report.samples,0.99),
    max:report.samples.length?Number(report.samples.at(-1).toFixed(1)):null
  };
  delete report.samples;
  report.passed=report.requests>0&&!report.aborted&&report.failures===0&&report.transportErrors===0;
  logger.log(JSON.stringify(report,null,2));
  return report;
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(isMain){
  try{
    const opts=parseOptions(process.argv.slice(2));
    if(opts.help){
      console.log('Usage: NODE_EXTRA_CA_CERTS=/etc/lightnas/tls/nas.crt node scripts/stress-local.mjs --url https://127.0.0.1:3080 --seconds 45 --rps 2 --concurrency 4');
      console.log('Read-only GETs, no credentials, no disk/network/VM changes. 1..12 RPS, 5..300 seconds.');
      console.log('For >3 RPS or >120 seconds use --ack-impact on a dedicated test instance.');
    }else{
      const report=await runStress(opts);
      if(!report.passed) process.exitCode=1;
    }
  }catch(error){console.error('Stress runner refused to start: '+error.message);process.exitCode=2;}
}
