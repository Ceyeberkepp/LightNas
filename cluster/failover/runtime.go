package failover

import (
 "context"
 "errors"
 "fmt"
 "os/exec"
 "strings"
)

// CommandRunner permits testable, argument-safe execution without a shell.
type CommandRunner interface {
 Run(context.Context,string,...string) error
}
type OSRunner struct{}
func (OSRunner) Run(ctx context.Context, program string, args ...string) error {
 out,err:=exec.CommandContext(ctx,program,args...).CombinedOutput()
 if err!=nil {return fmt.Errorf("%s failed: %w (%s)",program,err,strings.TrimSpace(string(out)))}
 return nil
}

// LocalRuntime starts already-defined local workloads after a trusted cluster
// coordinator has independently fenced the old owner and transferred storage
// ownership. It must run only on the selected target node via an authenticated
// node agent. It does NOT itself establish exclusive ownership or fencing.
type LocalRuntime struct {
 NodeID string
 Runner CommandRunner
}

// Start uses native host runtimes and never accepts an executable from user input.
// VM ID is a libvirt domain name; container ID is an LXC name; app ID is an
// existing Docker container name. No provisioning or disk mutations occur.
func (r LocalRuntime) Start(ctx context.Context, w Workload, target string) error {
 if r.Runner==nil || r.NodeID=="" || target!=r.NodeID {return errors.New("target node mismatch or runner missing")}
 if !safeName(w.ID) {return errors.New("invalid workload name")}
 switch w.Kind {
 case VM:
  return r.Runner.Run(ctx,"virsh","start",w.ID)
 case Container:
  return r.Runner.Run(ctx,"lxc-start","-n",w.ID)
 case App:
  return r.Runner.Run(ctx,"docker","start",w.ID)
 default:
  return errors.New("unsupported workload kind")
 }
}
func safeName(s string) bool {
 if len(s)<1 || len(s)>128 || s[0]=='-' {return false}
 for _,c:=range s {
  if !(c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c=='_'||c=='-'||c=='.') {return false}
 }
 return s!="." && s!=".."
}
