import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSftpGoMigration} from '../src/migration-sftpgo-preflight.mjs';
const base={application:'sftpgo',sourceVersionKnown:true,targetVersionCompatible:true,persistentMountsEnumerated:true,
fileDataRestoredAndVerified:true,usersGroupsFoldersVerified:true,configurationAndEnvironmentVerified:true,
sshHostKeyContinuityVerified:true,secretsReprovisioned:true,ownershipAndPermissionsVerified:true,
endpointPortsAndTlsVerified:true,loginUploadDownloadTested:true,sourceBackupRetained:true,rollbackTested:true,
database:{driver:'sqlite',consistentBackup:true,restoreVerified:true,sqliteWalCheckpointOrOfflineBackupVerified:true}};
test('complete evidence is a review, never production cutover authority',()=>{
 const r=reviewSftpGoMigration(base);
 assert.equal(r.evidenceComplete,true);
 assert.equal(r.migrationStarted,false);
 assert.equal(r.cutoverAuthorized,false);
 assert.equal(r.sourceDeletionAuthorized,false);
});
test('missing SQLite checkpoint blocks migration review',()=>{
 const r=reviewSftpGoMigration({...base,database:{...base.database,sqliteWalCheckpointOrOfflineBackupVerified:false}});
 assert.ok(r.blockers.includes('sqliteWalCheckpointOrOfflineBackupVerified'));
});
test('external database connectivity must be verified',()=>{
 const r=reviewSftpGoMigration({...base,database:{driver:'postgresql',consistentBackup:true,restoreVerified:true}});
 assert.ok(r.blockers.includes('remoteDatabaseConnectivityVerified'));
});
test('missing file storage and secrets block review',()=>{
 const r=reviewSftpGoMigration({...base,fileDataRestoredAndVerified:false,secretsReprovisioned:false});
 assert.ok(r.blockers.includes('fileDataRestoredAndVerified'));
 assert.ok(r.blockers.includes('secretsReprovisioned'));
});
test('reject unsupported data providers',()=>assert.throws(()=>reviewSftpGoMigration({...base,database:{driver:'unknown'}}),/supported SFTPGo data provider/));
