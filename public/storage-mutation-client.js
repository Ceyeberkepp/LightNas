async function request(path,body){const r=await fetch('/api/storage/agent'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-LightNAS-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||'Storage operation failed');return data;}
export async function approveStoragePreview(preview){
 if(!preview?.id||!preview?.approvalHash)throw Error('Storage impact preview is missing');
 const dialog=document.createElement('dialog');dialog.className='lightnas-dialog';dialog.style.maxWidth='min(850px,95vw)';
 const title=document.createElement('h2');title.textContent='Review storage impact';
 const details=document.createElement('pre');details.textContent=JSON.stringify(preview.impact,null,2);details.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto';
 const status=document.createElement('p');status.setAttribute('role','status');
 const progress=document.createElement('progress');progress.max=100;progress.value=0;
 const phrase=document.createElement('input');phrase.placeholder=preview.impact.confirmation||'';phrase.hidden=!preview.impact.confirmation;phrase.setAttribute('aria-label','Exact disk confirmation');
 const approve=document.createElement('button');approve.type='button';approve.textContent='Approve operation';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
 dialog.append(title,details,phrase,progress,status,approve,cancel);document.body.append(dialog);dialog.showModal();
 return new Promise((resolve,reject)=>{
  let running=false,approvalPending=false,closed=false,job;
  const close=()=>{closed=true;dialog.close();dialog.remove();};
  const refuse=()=>{close();reject(Error('Storage operation cancelled before execution'));};
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!running&&!approvalPending)refuse();});
  cancel.onclick=async()=>{if(approvalPending)return;if(!running){refuse();return;}try{job=await request('/jobs/'+preview.id+'/cancel',{});status.textContent='Cancellation requested';cancel.disabled=true;}catch(e){status.textContent=e.message;}};
  approve.onclick=async()=>{
   approve.disabled=true;approvalPending=true;cancel.disabled=true;status.textContent='Submitting this exact approval';
   try{
    job=await request('/jobs/'+preview.id+'/approve',{approvalHash:preview.approvalHash,confirmation:phrase.value});running=true;approvalPending=false;
    while(!closed){
     job=await request('/jobs/'+preview.id);progress.value=job.progress;status.textContent=job.status+' · '+(job.logs.at(-1)||'');cancel.disabled=!!job.commitStarted||!['queued','running'].includes(job.status);
     if(job.status==='succeeded'){close();resolve(job.result||{ok:true});return;}
     if(!['queued','running'].includes(job.status)){const error=Error(job.status==='cancelled'?'Storage operation cancelled before commit.':('Storage operation failed: '+(job.logs.at(-2)||job.logs.at(-1)||'Inspect job history')+' · Job '+job.id));error.rollback=job.rollback;close();reject(error);return;}
     await new Promise(r=>setTimeout(r,300));
    }
   }catch(e){if(running){close();reject(e);}else{approvalPending=false;approve.disabled=false;cancel.disabled=false;status.textContent=e.message;}}
  };
 });
}
