// Read-only Ceph cluster status assessment. No shell execution or host mutations.
export function assessCephStatus(input) {
  const status = typeof input === 'string' ? JSON.parse(input) : input;
  if (!status || typeof status !== 'object' || Array.isArray(status)) throw new TypeError('Ceph status must be an object');
  const reasons = [];
  const quorum = status.quorum_names;
  const monitors = status.monmap?.mons;
  if (!Array.isArray(monitors) || monitors.length === 0) reasons.push('Monitor inventory unavailable');
  if (!Array.isArray(quorum) || quorum.length === 0) reasons.push('Monitor quorum unavailable');
  if (Array.isArray(monitors) && Array.isArray(quorum) && monitors.length > 0) {
    const known = new Set(monitors.map(m => m?.name).filter(Boolean));
    if (quorum.some(name => !known.has(name))) reasons.push('Quorum includes unknown monitors');
    if (quorum.length <= Math.floor(monitors.length / 2)) reasons.push('Monitor majority not established');
  }
  const osd = status.osdmap?.osdmap ?? status.osdmap;
  const total = osd?.num_osds, up = osd?.num_up_osds, inCount = osd?.num_in_osds;
  if (![total,up,inCount].every(n => Number.isSafeInteger(n) && n >= 0) || total === 0) {
    reasons.push('OSD inventory unavailable');
  } else if (up !== total || inCount !== total) {
    reasons.push('OSDs are down or out');
  }
  const health = status.health?.status;
  if (health !== 'HEALTH_OK') reasons.push(health ? 'Ceph health is '+health : 'Ceph health unavailable');
  const pg = status.pgmap;
  if (!pg || !Number.isSafeInteger(pg.num_pgs) || pg.num_pgs <= 0) {
    reasons.push('Placement-group status unavailable');
  } else {
    const states = pg.pgs_by_state;
    if (!Array.isArray(states) || states.length === 0 ||
      states.some(s => !Number.isSafeInteger(s.count) || s.count < 0 || !/^(active\+clean|clean\+active)$/.test(s.state_name)) ||
      states.reduce((sum,s)=>sum+s.count,0) !== pg.num_pgs) {
      reasons.push('Placement groups not fully active+clean');
    }
  }
  return Object.freeze({ready:reasons.length===0,readOnly:true,reasons:Object.freeze(reasons),monitorsInQuorum:Array.isArray(quorum)?quorum.length:0,osdsTotal:Number.isSafeInteger(total)?total:null});
}
