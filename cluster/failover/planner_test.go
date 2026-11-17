package failover

import (
 "errors"
 "reflect"
 "testing"
)
func sample() Cluster {
 return Cluster{
  Quorum:true, FencingConfirmed:true, FailedNode:"n1",
  Nodes:[]Node{
   {ID:"n1",Healthy:false,CPUFree:20,MemoryFreeMiB:32000},
   {ID:"n2",Healthy:true,CPUFree:4,MemoryFreeMiB:8192,Networks:[]string{"lan"}},
   {ID:"n3",Healthy:true,CPUFree:4,MemoryFreeMiB:8192,Networks:[]string{"lan"}},
  },
  Workloads:[]Workload{
   {ID:"vm1",Kind:VM,SourceNode:"n1",CPU:3,MemoryMiB:4096,Network:"lan",RecoverableOn:[]string{"n2","n3"},Priority:10},
   {ID:"ct1",Kind:Container,SourceNode:"n1",CPU:2,MemoryMiB:2048,Network:"lan",RecoverableOn:[]string{"n2","n3"},Priority:5},
   {ID:"app1",Kind:App,SourceNode:"n1",CPU:1,MemoryMiB:1024,Network:"lan",RecoverableOn:[]string{"n2","n3"},Priority:1},
  },
 }
}
func TestAllWorkloadKindsRecovered(t *testing.T) {
 p,err:=PlanRecovery(sample()); if err!=nil {t.Fatal(err)}
 want:=[]Placement{{"vm1","n2"},{"ct1","n3"},{"app1","n3"}}
 if !reflect.DeepEqual(p.Placements,want) || len(p.Rejected)!=0 {t.Fatalf("got %+v want %+v",p,want)}
}
func TestNoQuorumOrFencingFailsClosed(t *testing.T) {
 for _,field:=range []string{"quorum","fencing"} {
  c:=sample(); if field=="quorum" {c.Quorum=false} else {c.FencingConfirmed=false}
  p,err:=PlanRecovery(c)
  if !errors.Is(err,ErrUnsafe) || len(p.Placements)!=0 {t.Fatalf("%s: %+v %v",field,p,err)}
 }
}
func TestNoStorageOrNetworkNoRecovery(t *testing.T) {
 c:=sample()
 c.Workloads[0].RecoverableOn=nil
 c.Workloads[1].Network="missing"
 p,err:=PlanRecovery(c)
 if err!=nil || len(p.Rejected)!=2 || len(p.Placements)!=1 || p.Placements[0].WorkloadID!="app1" {t.Fatalf("%+v %v",p,err)}
}
func TestInsufficientCapacityDoesNotOvercommit(t *testing.T) {
 c:=sample(); c.Nodes[1].CPUFree=2;c.Nodes[2].CPUFree=2
 p,err:=PlanRecovery(c)
 if err!=nil || len(p.Rejected)!=1 || p.Rejected[0].WorkloadID!="vm1" {t.Fatalf("%+v %v",p,err)}
}
func TestUnrelatedWorkloadsNotMoved(t *testing.T) {
 c:=sample();c.Workloads=append(c.Workloads,Workload{ID:"other",Kind:VM,SourceNode:"n2",CPU:1,MemoryMiB:256,RecoverableOn:[]string{"n3"}})
 p,err:=PlanRecovery(c);if err!=nil || len(p.Placements)!=3 {t.Fatalf("%+v %v",p,err)}
}
