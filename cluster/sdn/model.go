// Package sdn defines safe, declarative LightNAS software-defined network objects.
// It does not change host interfaces, routes, bridges, or firewall rules.
package sdn

import (
 "errors"
 "fmt"
 "net/netip"
)

type ZoneType string
const (
 Simple ZoneType = "simple"
 VLAN ZoneType = "vlan"
 VXLAN ZoneType = "vxlan"
)
type Zone struct {
 ID string
 Type ZoneType
 Nodes []string
 MTU int
}
type VNet struct {
 ID string
 ZoneID string
 VLANID int
 VNI int
}
type Subnet struct {
 ID string
 VNetID string
 CIDR string
 Gateway string
}
type Config struct {
 Zones []Zone
 VNets []VNet
 Subnets []Subnet
}
var ErrInvalid = errors.New("invalid SDN configuration")

// Validate checks declarative SDN configuration before any deployment.
// Network overlap policy is deliberately conservative: no overlapping subnets.
func Validate(c Config) error {
 zones:=map[string]Zone{}
 for _,z:=range c.Zones {
  if z.ID=="" || (z.Type!=Simple && z.Type!=VLAN && z.Type!=VXLAN) || z.MTU<576 || z.MTU>9216 {
   return fmt.Errorf("%w: zone",ErrInvalid)
  }
  if _,ok:=zones[z.ID];ok{return fmt.Errorf("%w: duplicate zone",ErrInvalid)}
  if len(z.Nodes)==0{return fmt.Errorf("%w: zone without nodes",ErrInvalid)}
  nodes:=map[string]bool{}
  for _,n:=range z.Nodes {if n=="" || nodes[n] {return fmt.Errorf("%w: invalid zone node",ErrInvalid)};nodes[n]=true}
  zones[z.ID]=z
 }
 vnets:=map[string]bool{}
 vlanUsed:=map[string]bool{}
 vniUsed:=map[int]bool{}
 for _,v:=range c.VNets {
  z,ok:=zones[v.ZoneID]
  if !ok || v.ID=="" || vnets[v.ID] {return fmt.Errorf("%w: VNet ID or zone",ErrInvalid)}
  switch z.Type {
  case Simple:
   if v.VLANID!=0 || v.VNI!=0{return fmt.Errorf("%w: simple VNet tags",ErrInvalid)}
  case VLAN:
   if v.VLANID<1 || v.VLANID>4094 || v.VNI!=0{return fmt.Errorf("%w: VLAN tag",ErrInvalid)}
   key:=v.ZoneID+":"+fmt.Sprint(v.VLANID)
   if vlanUsed[key] {return fmt.Errorf("%w: duplicate VLAN",ErrInvalid)}
   vlanUsed[key]=true
  case VXLAN:
   if v.VNI<1 || v.VNI>16777215 || v.VLANID!=0 || vniUsed[v.VNI] {return fmt.Errorf("%w: VXLAN VNI",ErrInvalid)}
   vniUsed[v.VNI]=true
  }
  vnets[v.ID]=true
 }
 subnets:=map[string]bool{}
 prefixes:=[]netip.Prefix{}
 for _,s:=range c.Subnets {
  if s.ID=="" || subnets[s.ID] || !vnets[s.VNetID] {return fmt.Errorf("%w: subnet identity",ErrInvalid)}
  p,err:=netip.ParsePrefix(s.CIDR)
  if err!=nil || p!=p.Masked() {return fmt.Errorf("%w: CIDR",ErrInvalid)}
  for _,prior:=range prefixes {
   if prior.Addr().Is4()==p.Addr().Is4() && (prior.Contains(p.Addr()) || p.Contains(prior.Addr())) {
    return fmt.Errorf("%w: overlapping subnet",ErrInvalid)
   }
  }
  if s.Gateway!="" {
   gateway,err:=netip.ParseAddr(s.Gateway)
   if err!=nil || !p.Contains(gateway) {return fmt.Errorf("%w: gateway",ErrInvalid)}
  }
  subnets[s.ID]=true
  prefixes=append(prefixes,p)
 }
 return nil
}
