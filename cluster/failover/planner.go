// Package failover plans safe workload recovery after a node outage.
// It does not fence hosts, migrate disks, or start workloads. A separate
// authenticated executor must revalidate every precondition before acting.
package failover

import (
 "errors"
 "sort"
)

type Kind string
const (
 VM Kind = "vm"
 Container Kind = "container"
 App Kind = "app"
)
type Node struct {
 ID string
 Healthy bool
 Fenced bool
 CPUFree int
 MemoryFreeMiB int
 Networks []string
}
type Workload struct {
 ID string
 Kind Kind
 SourceNode string
 CPU int
 MemoryMiB int
 Network string
 // RecoverableOn is the set of nodes with verified accessible, consistent
 // storage and the runtime required to restart this workload.
 RecoverableOn []string
 Priority int
}
type Cluster struct {
 Quorum bool
 FailedNode string
 // FencingConfirmed must come from an authoritative fencing controller,
 // not from an ICMP timeout or a self-reported node health value.
 FencingConfirmed bool
 Nodes []Node
 Workloads []Workload
}
type Placement struct { WorkloadID, TargetNode string }
type Rejected struct { WorkloadID, Reason string }
type Plan struct {
 Placements []Placement
 Rejected []Rejected
}
var ErrUnsafe = errors.New("automatic failover requires quorum and confirmed fencing")

func contains(xs []string, value string) bool {
 for _, x := range xs { if x == value { return true } }
 return false
}

// PlanRecovery is a deterministic, side-effect-free capacity and eligibility
// planner. A plan is advisory until the executor rechecks fencing, quorum,
// storage consistency, resource reservations, and workload generation.
func PlanRecovery(c Cluster) (Plan, error) {
 var plan Plan
 if !c.Quorum || !c.FencingConfirmed || c.FailedNode == "" { return plan, ErrUnsafe }
 nodes := append([]Node(nil), c.Nodes...)
 sort.Slice(nodes, func(i,j int) bool { return nodes[i].ID < nodes[j].ID })
 jobs := append([]Workload(nil), c.Workloads...)
 sort.Slice(jobs, func(i,j int) bool {
  if jobs[i].Priority != jobs[j].Priority { return jobs[i].Priority > jobs[j].Priority }
  return jobs[i].ID < jobs[j].ID
 })
 seen := make(map[string]bool)
 for _, w := range jobs {
  if w.SourceNode != c.FailedNode { continue }
  reason := "no healthy node with sufficient capacity, network, and verified storage"
  if w.ID == "" || seen[w.ID] || w.CPU <= 0 || w.MemoryMiB <= 0 ||
   (w.Kind != VM && w.Kind != Container && w.Kind != App) {
   plan.Rejected = append(plan.Rejected, Rejected{w.ID, "invalid or duplicate workload"}); continue
  }
  seen[w.ID] = true
  best := -1
  for i := range nodes {
   n := &nodes[i]
   if !n.Healthy || n.ID == "" || n.ID == c.FailedNode ||
    n.CPUFree < w.CPU || n.MemoryFreeMiB < w.MemoryMiB ||
    !contains(w.RecoverableOn,n.ID) ||
    (w.Network != "" && !contains(n.Networks,w.Network)) { continue }
   // Pack on the node with the greatest remaining CPU capacity, breaking ties by ID.
   if best == -1 || n.CPUFree > nodes[best].CPUFree { best = i }
  }
  if best == -1 { plan.Rejected = append(plan.Rejected,Rejected{w.ID,reason}); continue }
  nodes[best].CPUFree -= w.CPU
  nodes[best].MemoryFreeMiB -= w.MemoryMiB
  plan.Placements = append(plan.Placements,Placement{w.ID,nodes[best].ID})
 }
 return plan,nil
}
