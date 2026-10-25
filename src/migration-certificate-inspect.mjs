import tls from 'node:tls';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
function privateIP(ip) {
 if(isIP(ip)===4) {
  const a=ip.split('.').map(Number);
  return a[0]===10 || (a[0]===192&&a[1]===168) || (a[0]===172&&a[1]>=16&&a[1]<=31);
 }
 return isIP(ip)===6 && /^(?:fd|fc)/i.test(ip);
}
export async function inspectMigrationCertificate({host,port=443}) {
 if(typeof host!=='string'||!/^[A-Za-z0-9.:-]{1,253}$/.test(host)||host.includes('..')||
  !Number.isInteger(port)||port<1||port>65535)throw Object.assign(new Error('Invalid source host or port'),{status:400});
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(x=>!privateIP(x.address)))
  throw Object.assign(new Error('Certificate checks only support private LAN hosts'),{status:400});
 const address=addresses[0].address;
 return await new Promise((resolve,reject)=>{
  const sock=tls.connect({host:address,port,servername:isIP(host)?undefined:host,
   rejectUnauthorized:false,timeout:8000});
  let done=false;
  const finish=(error,result)=>{if(done)return;done=true;sock.destroy();error?reject(error):resolve(result);};
  sock.on('secureConnect',()=>{
   const cert=sock.getPeerCertificate();
   if(!cert?.fingerprint256)return finish(Object.assign(new Error('Server did not present a certificate'),{status:409}));
   finish(null,{host,port,subject:cert.subject?.CN||'',issuer:cert.issuer?.CN||'',
    validFrom:cert.valid_from||'',validTo:cert.valid_to||'',
    subjectAlternativeName:cert.subjectaltname||'',sha256Fingerprint:cert.fingerprint256,
    trustedBySystem:sock.authorized===true,trustError:sock.authorizationError||null,
    readOnly:true,credentialsSent:false,trustEstablished:false,
    warning:'Inspection does not authenticate this server. Compare fingerprint using a separate trusted channel before approving any future trust action.'});
  });
  sock.on('timeout',()=>finish(Object.assign(new Error('Certificate inspection timed out'),{status:504})));
  sock.on('error',()=>finish(Object.assign(new Error('Cannot inspect server certificate over TLS'),{status:409})));
 });
}
