import {open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export async function atomic(path,text){
 const temporary=path+'.'+randomUUID()+'.tmp';const file=await open(temporary,'wx',0o600);
 try{await file.writeFile(text);await file.sync();}finally{await file.close();}
 try{await rename(temporary,path);const directory=await open(path.slice(0,path.lastIndexOf('/'))||'.','r');try{await directory.sync();}finally{await directory.close();}}catch(e){await unlink(temporary).catch(()=>{});throw e;}
}
