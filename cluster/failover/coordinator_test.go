package failover

import (
 "context"
 "errors"
 "testing"
)
type testGate struct {calls int; failAfter int}
func (g *testGate) Check(_ context.Context,_ string) error {
 g.calls++
 if g.failAfter>0 && g.calls>=g.failAfter{return errors.New("quorum or fencing lost")}
 return nil
}
type testBackend struct {keys []string; failID string}
func (b *testBackend) Recover(_ context.Context,w Workload,_ string,key string) error {
 b.keys=append(b.keys,key)
 if w.ID==b.failID{return errors.New("restart failed")}
 return nil
}
func TestRecoveryCoordinator(t *testing.T) {
 c:=sample();p,err:=PlanRecovery(c);if err!=nil {t.Fatal(err)}
 gate:=&testGate{};backend:=&testBackend{}
 r,err:=RecoverPlan(context.Background(),c,p,gate,backend,"epoch-1")
 if err!=nil || len(r.Started)!=3 || len(backend.keys)!=3 || gate.calls!=4 {t.Fatalf("%+v %v, gate=%d",r,err,gate.calls)}
 if backend.keys[0]!="epoch-1:n1:vm1" {t.Fatalf("unexpected key: %v",backend.keys)}
}
func TestRecoveryStopsWhenGateLost(t *testing.T) {
 c:=sample();p,_:=PlanRecovery(c)
 gate:=&testGate{failAfter:3};backend:=&testBackend{}
 r,err:=RecoverPlan(context.Background(),c,p,gate,backend,"epoch-1")
 if err==nil || len(r.Started)!=1 || len(backend.keys)!=1 {t.Fatalf("%+v %v",r,err)}
}
func TestRecoveryRejectsUnapprovedPlacement(t *testing.T) {
 c:=sample();p,_:=PlanRecovery(c);p.Placements[0].TargetNode="n1"
 backend:=&testBackend{}
 _,err:=RecoverPlan(context.Background(),c,p,&testGate{},backend,"epoch-1")
 if err==nil || len(backend.keys)!=0 {t.Fatal("unapproved placement executed")}
}
func TestRecoveryRequiresTrustedComponents(t *testing.T) {
 c:=sample();p,_:=PlanRecovery(c)
 _,err:=RecoverPlan(context.Background(),c,p,nil,&testBackend{},"epoch-1")
 if !errors.Is(err,ErrNoGate) {t.Fatalf("got %v",err)}
}
func TestRecoveryReportsPartialFailures(t *testing.T) {
 c:=sample();p,_:=PlanRecovery(c)
 r,err:=RecoverPlan(context.Background(),c,p,&testGate{},&testBackend{failID:"vm1"},"epoch-1")
 if err!=nil || len(r.Started)!=2 || len(r.Failed)!=1 || r.Failed[0].WorkloadID!="vm1" {t.Fatalf("%+v %v",r,err)}
}
