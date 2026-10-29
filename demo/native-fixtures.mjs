const GiB=1024**3,TiB=1024**4;
const timestamp=(minutes=0)=>new Date(Date.now()-minutes*60000).toISOString();
const sampleDisks=Array.from({length:4},(_,i)=>({path:'/dev/demo'+(i+1),name:'demo'+(i+1),model:'DEMO VIRTUAL DISK',sizeBytes:4*TiB,system:false,blank:false,mounted:true,transport:'virtual',sample:true}));
const samplePool={id:'sample-media',name:'Media Pool',type:'zfs',provider:'ZFS',mountPoint:'/demo/media',local:true,dedicated:true,online:true,writable:false,capacityKnown:true,totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB,usedPercent:39,content:['files','backups'],contentLabels:['Files','Backups']};
const sampleVolumes=[{device:'/dev/demo-pool',mountPoint:'/demo/media',totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB,usedPercent:39}];
const sampleStorage={usableStorage:{totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB,usedPercent:39,count:1},local:{totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB,usedPercent:39,count:1},configuredPools:[samplePool],availableSources:[],detectedDisks:sampleDisks,disks:sampleDisks,attachedVolumes:sampleVolumes,zfs:{available:true,canManageDatasets:false,pools:[{name:'demo-tank',sizeBytes:12*TiB,allocatedBytes:4.7*TiB,freeBytes:7.3*TiB,health:'ONLINE'}],datasets:[{name:'demo-tank/Media',mountPoint:'/demo/media',usedBytes:4.7*TiB,availableBytes:7.3*TiB}]}};
const sampleSystem={hostname:'lightnas-demo',platform:'linux',distribution:'Debian GNU/Linux',release:'13',kernel:'6.8.12-demo',architecture:'x64',uptimeSeconds:1296000,cpu:{model:'Demo 8-core CPU',cores:8,loadPercent:18,usagePercent:18,loadAverage:[0.35,0.44,0.51]},memory:{totalBytes:16*GiB,usedBytes:6.2*GiB,freeBytes:9.8*GiB,availableBytes:9.8*GiB,usedPercent:39},network:{interfaces:1,primaryIpv4:'192.0.2.10',receivedBytes:3.1*GiB,transmittedBytes:1.6*GiB,rxBytesPerSecond:138241,txBytesPerSecond:48021},temperature:42};
const sampleActivity=[{type:'backup',message:'Sample daily backup completed',timestamp:timestamp(120),status:'success'},{type:'app',message:'Sample monitoring application is online',timestamp:timestamp(310),status:'success'},{type:'file',message:'Example project files added to library',timestamp:timestamp(1440),status:'success'},{type:'setup',message:'LightNAS demo initialized',timestamp:timestamp(5760),status:'success'}];
const appliance={username:'demo-admin',displayName:'Demo Administrator',deviceName:'lightnas-demo',deviceNameVisible:true,online:true,role:'administrator',permissions:[],timezone:'America/New_York',avatar:false,brandName:'LightNAS',logoMode:'picture',logo:true,customLogo:false,defaultBranding:true,features:{appStore:true,containers:true,virtualMachines:true,ai:true,phoneSync:true,monitoringAnalytics:true,integrations:true}};
const sampleApps=[
{id:'jellyfin',name:'Jellyfin',category:'Media',description:'Open-source media library',image:'jellyfin/jellyfin:latest',port:8096},
{id:'uptime-kuma',name:'Uptime Kuma',category:'Monitoring',description:'Service availability monitoring',image:'louislam/uptime-kuma:latest',port:3001},
{id:'immich',name:'Immich',category:'Photos',description:'Photo management and backups',image:'ghcr.io/immich-app/immich-server:release',port:2283},
{id:'nextcloud',name:'Nextcloud',category:'Productivity',description:'Private file collaboration',image:'nextcloud:latest',port:8080},
{id:'home-assistant',name:'Home Assistant',category:'Automation',description:'Smart home automation',image:'ghcr.io/home-assistant/home-assistant:stable',port:8123},
{id:'paperless-ngx',name:'Paperless-ngx',category:'Productivity',description:'Document management and indexing',image:'ghcr.io/paperless-ngx/paperless-ngx:latest',port:8000}
];
const sampleContainers={available:true,enabled:false,reason:'Public demo: real container operations are disabled.',provider:'LXC',containers:[{id:'101',name:'sample-web',status:'running',cpus:2,memory:2*GiB,ipv4:'192.0.2.101',cpuPercent:5,memoryUsageBytes:350*1024*1024,liveStats:true}]};
const sampleVMs={available:true,enabled:false,reason:'Public demo: real virtualization operations are disabled.',provider:'QEMU/KVM',machineDetails:[{id:'vm-1',name:'Sample Linux VM',status:'running',cpus:2,memory:4*GiB,ipv4:'192.0.2.120'}]};
const sampleRuntimes={containers:sampleContainers,virtualization:sampleVMs,docker:{available:true,enabled:false,reason:'Public demo: applications cannot be installed.',containers:[{name:'lightnas-app-uptime-kuma',status:'running',state:'running',managed:true,ip:'192.0.2.10',port:3001,liveStats:true,cpuPercent:1.2,memoryUsage:'120 MiB'}]},catalog:sampleApps};
const sampleUsers=[{username:'alex',disabled:false,permissions:['files.own'],groups:['staff'],storageQuotaBytes:5*GiB,createdAt:timestamp(12000)},{username:'maria',disabled:false,permissions:['files.own'],groups:['staff'],storageQuotaBytes:5*GiB,createdAt:timestamp(20000)},{username:'guest',disabled:true,permissions:['files.read'],groups:['guests'],storageQuotaBytes:1*GiB,createdAt:timestamp(30000)}];
const sampleGroups=[{id:'staff',name:'Staff',members:['alex','maria'],permissions:['files.own']},{id:'guests',name:'Guests',members:['guest'],permissions:['files.read']}];
const files=[
{path:'Documents',name:'Documents',directory:true,sizeBytes:0},
{path:'Photos',name:'Photos',directory:true,sizeBytes:0},
{path:'Videos',name:'Videos',directory:true,sizeBytes:0},
{path:'Audio',name:'Audio',directory:true,sizeBytes:0},
{path:'Shared Projects',name:'Shared Projects',directory:true,sizeBytes:0},
{path:'Documents/Welcome to LightNAS.txt',name:'Welcome to LightNAS.txt',directory:false,sizeBytes:2048},
{path:'Documents/Project Plan.pdf',name:'Project Plan.pdf',directory:false,sizeBytes:1.2*1024*1024},
{path:'Photos/Demo Album.jpg',name:'Demo Album.jpg',directory:false,sizeBytes:3.4*1024*1024},
{path:'Videos/LightNAS Tour.mp4',name:'LightNAS Tour.mp4',directory:false,sizeBytes:40*1024*1024},
{path:'Audio/Sample.wav',name:'Sample.wav',directory:false,sizeBytes:4.1*1024*1024},
{path:'Shared Projects/Product Roadmap.pdf',name:'Product Roadmap.pdf',directory:false,sizeBytes:640*1024}
].map((f,i)=>({...f,supported:true,modifiedAt:timestamp(i*55),folder:f.path.includes('/')?f.path.substring(0,f.path.lastIndexOf('/')):''}));
const backupJobs=[{id:'backup-daily',name:'Daily NAS backup',source:'Media Pool',destination:'Backup Vault',schedule:'0 2 * * *',enabled:true,lastRunAt:timestamp(160),status:'success',lastStatus:'success'},{id:'backup-photos',name:'Weekly photo archive',source:'Photos',destination:'Sample Remote',schedule:'0 3 * * 0',enabled:true,lastRunAt:timestamp(6000),status:'success',lastStatus:'success'}];
const branding={...appliance};
const overview=()=>({appliance,system:sampleSystem,filesystems:[{device:'/dev/demo-pool',mountPoint:'/demo/media',type:'zfs',totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB}],storage:sampleStorage,host:null,shares:[],activity:sampleActivity});
const dataFor=(pathname,params)=>{
  switch(pathname){
    case '/api/status':return {version:'demo',setupRequired:false};
    case '/api/overview':return overview();
    case '/api/branding':return branding;
    case '/api/profile':return {username:'demo-admin',displayName:'Demo Administrator',email:'',isAdmin:true,createdAt:timestamp(10000),avatar:false};
    case '/api/runtimes':return sampleRuntimes;
    case '/api/catalog/builtin':return {catalog:sampleApps,count:sampleApps.length};
    case '/api/catalog/community':return {apps:[],sources:[],count:0,refreshing:false};
    case '/api/users':return {users:sampleUsers,groups:sampleGroups,permissionOptions:['files.view.own','files.own','files.read','files.write','files.download','storage.view','apps.view']};
    case '/api/groups':return {groups:sampleGroups,permissionOptions:['files.view.own','files.own','files.read']};
    case '/api/spaces':return {spaces:[{name:'Shared_Projects',label:'Shared Projects'}]};
    case '/api/files':{
      const path=params.get('path')||'';
      const entries=params.get('all')==='1'?files.filter(f=>!f.directory):params.get('folders')==='1'?files.filter(f=>f.directory):files.filter(f=>f.path!==path && f.folder===path);
      return {path,entries,truncated:false};
    }
    case '/api/files/quota':return {usedBytes:4.7*TiB,totalBytes:12*TiB,availableBytes:7.3*TiB,quotaBytes:12*TiB};
    case '/api/storage/scan':return {disks:sampleDisks,attachedVolumes:sampleVolumes};
    case '/api/storage/pools':return {pools:[samplePool],visibleSummary:{verified:true,totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB},summary:{totalBytes:12*TiB,usedBytes:4.7*TiB,availableBytes:7.3*TiB},availableSources:[],detectedDisks:sampleDisks};
    case '/api/storage/agent/creation-options':return {sources:[],availableSources:[],devices:[],pools:[]};
    case '/api/backups/jobs':return {jobs:backupJobs};
    case '/api/containers/inventory':return sampleContainers;
    case '/api/containers':return sampleContainers;
    case '/api/vms':return {virtualization:sampleVMs,vms:sampleVMs.machineDetails,machines:sampleVMs.machineDetails};
    case '/api/vms/create-options':return {available:false,reason:'Demo only'};
    case '/api/network':return {host:null,interfaces:[{name:'eth0',state:'up',mtu:1500,mac:'02:00:00:00:00:01',addresses:[{family:'inet',address:'192.0.2.10',prefix:24}]}],routes:[{destination:'default',gateway:'192.0.2.1',device:'eth0',metric:100}],dns:['192.0.2.53'],firewall:{enabled:true,rules:[]},control:{editable:false,manager:'Demo network',devices:[{name:'eth0',type:'ethernet',state:'connected',connection:'Demo uplink'}],connections:[{name:'Demo uplink',device:'eth0',type:'ethernet',ipv4:{method:'manual'}}],wifi:[],bridge:null}};
    case '/api/media':return {converterAvailable:false,items:[]};
    case '/api/settings':return {deviceName:'lightnas-demo',timezone:'America/New_York',features:appliance.features};
    case '/api/software':return {version:'Demo preview',updateAvailable:false,updateEnabled:false,checkStatus:'disabled'};
    case '/api/license':return {edition:'community',verified:false,serverConfigured:false};
    case '/api/smtp':return {configured:false,enabled:false};
    case '/api/shares':return {shares:[]};
    case '/api/logs':return {logs:sampleActivity};
    case '/api/features':return {features:appliance.features};
    case '/api/appliance/health':return {healthy:true,services:[],issues:[],status:'demo'};
    case '/api/capabilities/config':return {capabilities:[],hardware:sampleSystem};
    case '/api/templates':return {templates:[]};
    case '/api/templates/catalog':return {templates:[]};
    case '/api/zfs/datasets':return {pools:sampleStorage.zfs.pools,datasets:sampleStorage.zfs.datasets,canManageDatasets:false};
    default:return null;
  }
};
export {dataFor};