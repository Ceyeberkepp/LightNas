// Read-only SFTPGo migration compatibility acceptance; does not migrate secrets or data.
const TYPES=new Set(['sqlite','postgresql','mysql','cockroachdb','bolt','memory']);
function error(s){throw Object.assign(new Error(s),{status:400});}
export function reviewSftpGoMigration(input){
 if(!input||typeof input!=='object'||Array.isArray(input))error('Invalid SFTPGo compatibility report');
 if(input.application!=='sftpgo')error('SFTPGo application identity required');
 const db=input.database||{};
 if(!TYPES.has(db.driver))error('Select a supported SFTPGo data provider');
 const checks={
   sourceVersionKnown:input.sourceVersionKnown===true,
   targetVersionCompatible:input.targetVersionCompatible===true,
   persistentMountsEnumerated:input.persistentMountsEnumerated===true,
   fileDataRestoredAndVerified:input.fileDataRestoredAndVerified===true,
   databaseBackupConsistent:db.consistentBackup===true,
   databaseRestoreVerified:db.restoreVerified===true,
   usersGroupsFoldersVerified:input.usersGroupsFoldersVerified===true,
   configurationAndEnvironmentVerified:input.configurationAndEnvironmentVerified===true,
   sshHostKeyContinuityVerified:input.sshHostKeyContinuityVerified===true,
   secretsReprovisioned:input.secretsReprovisioned===true,
   ownershipAndPermissionsVerified:input.ownershipAndPermissionsVerified===true,
   endpointPortsAndTlsVerified:input.endpointPortsAndTlsVerified===true,
   loginUploadDownloadTested:input.loginUploadDownloadTested===true,
   sourceBackupRetained:input.sourceBackupRetained===true,
   rollbackTested:input.rollbackTested===true
 };
 if(db.driver==='sqlite')checks.sqliteWalCheckpointOrOfflineBackupVerified=db.sqliteWalCheckpointOrOfflineBackupVerified===true;
 if(['postgresql','mysql','cockroachdb'].includes(db.driver))checks.remoteDatabaseConnectivityVerified=db.remoteDatabaseConnectivityVerified===true;
 const blockers=Object.keys(checks).filter(k=>!checks[k]);
 return {application:'sftpgo',phase:'compatibility-review',dataProvider:db.driver,
  checks,blockers,evidenceComplete:blockers.length===0,
  migrationStarted:false,cutoverAuthorized:false,sourceDeletionAuthorized:false,
  note:'A complete checklist alone does not prove the source and destination match; migration, integrity comparison and end-to-end tests remain required.'};
}
