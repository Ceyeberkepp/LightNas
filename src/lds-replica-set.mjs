import {createHash} from 'node:crypto';
/** Experimental immutable chunk replication coordinator. No mutable metadata consensus.
 * Stores must acknowledge only after durable publication. Independent domains must be
 * verified by deployment; this module does not authenticate remote nodes.
 */
export class LdsReplicaSet {
 constructor(nodes,{replicas=3}={}){
 if(!Array.isArray(nodes)||!Number.isSafeInteger(replicas)||replicas<3||replicas%2!==1||nodes.length!==replicas)throw new TypeError('odd fixed replica set of at least three required');
 const ids=new Set(),domains=new Set();
 for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||typeof n.domain!=='string'||!n.domain||ids.has(n.id)||domains.has(n.domain)||typeof n.store?.put!=='function'||typeof n.store?.get!=='function')throw new TypeError('independent replica stores required');ids.add(n.id);domains.add(n.domain)}
 this.nodes=nodes.map(n=>Object.freeze({...n}));this.quorum=Math.floor(replicas/2)+1;
 }
 async put(data){
 if(!(data instanceof Uint8Array)||!data.length||data.length>8388608)throw new TypeError('invalid chunk size');
 const bytes=Buffer.from(data),id=createHash('sha256').update(bytes).digest('hex');
 const results=await Promise.allSettled(this.nodes.map(async n=>{if(await n.store.put(Buffer.from(bytes))!==id)throw new Error('replica checksum mismatch');return n.id}));
 const acknowledged=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
 if(acknowledged.length<this.quorum)throw new Error('durable replica quorum unavailable');
 return {id,acknowledged,degraded:acknowledged.length!==this.nodes.length};
 }
 async get(id){
 if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new TypeError('invalid chunk ID');
 return Promise.any(this.nodes.map(async n=>{const b=Buffer.from(await n.store.get(id));if(createHash('sha256').update(b).digest('hex')!==id)throw new Error('replica corruption');return b}));
 }
 async repair(id){const data=await this.get(id);return this.put(data)}
}
