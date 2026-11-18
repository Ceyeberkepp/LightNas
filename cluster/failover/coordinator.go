package failover

import (
 "context"
 "errors"
 "fmt"
)

// RecoveryGate must independently establish current cluster state from trusted
// cluster services. Never implement this using a caller-provided HTTP snapshot.
type RecoveryGate interface {
 Check(ctx context.Context, failedNode string) error
}
// RecoveryBackend must atomically reserve the workload, verify exclusive
// storage ownership, and start the workload with an idempotency key.
// Implementations must reject stale cluster epochs and duplicate starts.
type RecoveryBackend interface {
 Recover(ctx context.Context, workload Workload, target string, key string) error
}
// RecoveryResult records partial recovery without concealing failed workloads.
type RecoveryResult struct {
 Started []Placement
 Failed []Rejected
}
var ErrNoGate = errors.New("trusted recovery gate and backend are required")

// RecoverPlan is a fail-closed coordinator. It cannot itself perform host
// fencing or guarantee durable distributed locking: those are responsibilities
// of the injected trusted implementations.
func RecoverPlan(ctx context.Context, c Cluster, plan Plan, gate RecoveryGate, backend RecoveryBackend, epoch string) (RecoveryResult,error) {
 var result RecoveryResult
 if gate==nil || backend==nil || epoch=="" {return result,ErrNoGate}
 if err:=gate.Check(ctx,c.FailedNode);err!=nil{return result,fmt.Errorf("recovery gate: %w",err)}
 authoritative,err:=PlanRecovery(c)
 if err!=nil{return result,err}
 allowed:=make(map[Placement]bool,len(authoritative.Placements))
 for _,p:=range authoritative.Placements {allowed[p]=true}
 workloadByID:=make(map[string]Workload,len(c.Workloads))
 for _,w:=range c.Workloads {
  if _,exists:=workloadByID[w.ID];exists{return result,errors.New("duplicate workload inventory")}
  workloadByID[w.ID]=w
 }
 seen:=make(map[string]bool)
 for _,p:=range plan.Placements {
  if ctx.Err()!=nil{return result,ctx.Err()}
  if !allowed[p] || seen[p.WorkloadID] {return result,errors.New("unapproved or duplicate placement")}
  seen[p.WorkloadID]=true
 }
 for _,p:=range plan.Placements {
  if ctx.Err()!=nil{return result,ctx.Err()}
  // Recheck immediately before each workload, not only once per batch.
  if err:=gate.Check(ctx,c.FailedNode);err!=nil{return result,fmt.Errorf("recovery gate lost: %w",err)}
  w:=workloadByID[p.WorkloadID]
  key:=epoch+":"+c.FailedNode+":"+p.WorkloadID
  if err:=backend.Recover(ctx,w,p.TargetNode,key);err!=nil {
   result.Failed=append(result.Failed,Rejected{WorkloadID:p.WorkloadID,Reason:err.Error()})
   continue
  }
  result.Started=append(result.Started,p)
 }
 return result,nil
}
