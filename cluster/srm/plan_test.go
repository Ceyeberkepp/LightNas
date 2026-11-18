package srm

import "testing"

func sample() Plan {
 return Plan{ID:"dr1",ProtectedSite:"site-a",RecoverySite:"site-b",Workloads:[]Workload{
  {ID:"web",Kind:"app",Dependencies:[]string{"db"},TargetNode:"node-b",TargetVNet:"recovery",ReplicationAgeSeconds:10,MaxRPOSeconds:60},
  {ID:"db",Kind:"vm",TargetNode:"node-b",TargetVNet:"recovery",ReplicationAgeSeconds:10,MaxRPOSeconds:60},
 }}
}
func TestDryRunOrdersDependencies(t *testing.T) {
 r,err:=DryRun(sample())
 if err!=nil || len(r.OrderedWorkloads)!=2 || r.OrderedWorkloads[0]!="db" {t.Fatalf("%+v %v",r,err)}
}
func TestDryRunRejectsStaleReplication(t *testing.T) {
 p:=sample();p.Workloads[0].ReplicationAgeSeconds=61
 if _,err:=DryRun(p);err==nil {t.Fatal("stale replication accepted")}
}
func TestDryRunRejectsMissingNetwork(t *testing.T) {
 p:=sample();p.Workloads[0].TargetVNet=""
 if _,err:=DryRun(p);err==nil {t.Fatal("missing VNet accepted")}
}
func TestDryRunRejectsDependencyCycle(t *testing.T) {
 p:=sample();p.Workloads[1].Dependencies=[]string{"web"}
 if _,err:=DryRun(p);err==nil {t.Fatal("dependency cycle accepted")}
}
func TestDryRunRejectsSameSite(t *testing.T) {
 p:=sample();p.RecoverySite=p.ProtectedSite
 if _,err:=DryRun(p);err==nil {t.Fatal("same site accepted")}
}
