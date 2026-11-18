package failover

import (
 "context"
 "errors"
 "reflect"
 "testing"
)
type fakeRunner struct {commands [][]string; err error}
func (f *fakeRunner) Run(_ context.Context,exe string,args ...string) error {
 f.commands=append(f.commands,append([]string{exe},args...))
 return f.err
}
func TestLocalRuntimeStartsAllKinds(t *testing.T) {
 for _,tc:=range []struct{kind Kind;cmd []string}{
  {VM,[]string{"virsh","start","workload1"}},
  {Container,[]string{"lxc-start","-n","workload1"}},
  {App,[]string{"docker","start","workload1"}},
 } {
  f:=&fakeRunner{}
  r:=LocalRuntime{NodeID:"node-b",Runner:f}
  err:=r.Start(context.Background(),Workload{ID:"workload1",Kind:tc.kind},"node-b")
  if err!=nil || !reflect.DeepEqual(f.commands,[][]string{tc.cmd}) {t.Fatalf("%s: %v %+v",tc.kind,err,f.commands)}
 }
}
func TestLocalRuntimeRefusesWrongNode(t *testing.T) {
 f:=&fakeRunner{}
 err:= (LocalRuntime{NodeID:"node-b",Runner:f}).Start(context.Background(),Workload{ID:"vm1",Kind:VM},"node-a")
 if err==nil || len(f.commands)!=0 {t.Fatal("executed on wrong node")}
}
func TestLocalRuntimeRejectsUnsafeNames(t *testing.T) {
 for _,name:=range []string{"-rf","foo;touch /tmp/pwned","../etc/passwd","",".."} {
  f:=&fakeRunner{}
  err:=(LocalRuntime{NodeID:"node-b",Runner:f}).Start(context.Background(),Workload{ID:name,Kind:VM},"node-b")
  if err==nil || len(f.commands)!=0 {t.Fatalf("unsafe name %q accepted",name)}
 }
}
func TestLocalRuntimePropagatesFailure(t *testing.T) {
 f:=&fakeRunner{err:errors.New("runtime unavailable")}
 err:=(LocalRuntime{NodeID:"node-b",Runner:f}).Start(context.Background(),Workload{ID:"vm1",Kind:VM},"node-b")
 if err==nil {t.Fatal("runtime failure hidden")}
}
