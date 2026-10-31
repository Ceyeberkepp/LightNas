import {open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export async function atomic(path,text,{openFile=open,renameFile=rename,unlinkFile=unlink}={}){
 const temporary=path+'.'+randomUUID()+'.tmp';
 let renamed=false;
 try{
  const file=await openFile(temporary,'wx',0o600);
  try{await file.writeFile(text);await file.sync();}finally{await file.close();}
  await renameFile(temporary,path);renamed=true;
  const directory=await openFile(path.slice(0,path.lastIndexOf('/'))||'.','r');
  try{await directory.sync();}finally{await directory.close();}
 }catch(error){
  // Failed writes and pre-rename sync errors must not leave sensitive temp files.
  // After rename, durability is uncertain if directory fsync fails; report it.
  if(!renamed)await unlinkFile(temporary).catch(()=>{});
  throw error;
 }
}
