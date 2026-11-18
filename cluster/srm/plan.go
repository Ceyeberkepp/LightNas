// Package srm provides non-destructive disaster recovery plan validation.
// No function in this package starts workloads or changes storage or networking.
package srm

import (
 "errors"
 "fmt"
 "sort"
 "time"
)

type Workload struct {
 ID string
 Kind string
 Dependencies []string
 TargetNode string
 TargetVNet string
 ReplicationAgeSeconds int64
 MaxRPOSeconds int64
}
type Plan struct {
 ID string
 ProtectedSite string
 RecoverySite string
 Workloads []Workload
}
type Report struct {
 OrderedWorkloads []string
 Warnings []string
}
var ErrInvalid=errors.New("invalid SRM recovery plan")

// DryRun validates explicit target mappings and recovery points, then produces
// dependency-ordered startup. A passing dry-run is NOT authorization to fail over.
func DryRun(p Plan) (Report,error) {
 var r Report
 if p.ID=="" || p.ProtectedSite=="" || p.RecoverySite=="" || p.ProtectedSite==p.RecoverySite {
  return r,fmt.Errorf("%w: site pairing",ErrInvalid)
 }
 workloads:=map[string]Workload{}
 for _,w:=range p.Workloads {
  if w.ID=="" || w.TargetNode=="" || w.TargetVNet=="" ||
   (w.Kind!="vm" && w.Kind!="container" && w.Kind!="app") ||
   w.ReplicationAgeSeconds<0 || w.MaxRPOSeconds<0 {
   return r,fmt.Errorf("%w: workload or target mapping",ErrInvalid)
  }
  if _,exists:=workloads[w.ID];exists{return r,fmt.Errorf("%w: duplicate workload",ErrInvalid)}
  if w.ReplicationAgeSeconds>w.MaxRPOSeconds {
   return r,fmt.Errorf("%w: RPO exceeded for %s",ErrInvalid,w.ID)
  }
  workloads[w.ID]=w
 }
 // Deterministic topological sort with cycle and missing-dependency rejection.
 ids:=make([]string,0,len(workloads))
 for id:=range workloads {ids=append(ids,id)}
 sort.Strings(ids)
 states:=map[string]int{}
 var visit func(string) error
 visit=func(id string) error {
  if states[id]==1 {return fmt.Errorf("%w: dependency cycle",ErrInvalid)}
  if states[id]==2{return nil}
  w,ok:=workloads[id];if !ok{return fmt.Errorf("%w: missing dependency %s",ErrInvalid,id)}
  states[id]=1
  deps:=append([]string(nil),w.Dependencies...)
  sort.Strings(deps)
  for _,dep:=range deps {if err:=visit(dep);err!=nil{return err}}
  states[id]=2
  r.OrderedWorkloads=append(r.OrderedWorkloads,id)
  return nil
 }
 for _,id:=range ids {if err:=visit(id);err!=nil{return Report{},err}}
 return r,nil
}

// Time-based freshness must be established from trusted replication metadata,
// never from an unverified caller timestamp.
var _ = time.Second
