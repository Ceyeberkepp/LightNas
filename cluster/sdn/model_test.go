package sdn

import "testing"

func sample() Config {
 return Config{
  Zones:[]Zone{{ID:"zone1",Type:VXLAN,Nodes:[]string{"node1","node2"},MTU:1450}},
  VNets:[]VNet{{ID:"prod",ZoneID:"zone1",VNI:10010}},
  Subnets:[]Subnet{{ID:"sub1",VNetID:"prod",CIDR:"10.10.0.0/24",Gateway:"10.10.0.1"}},
 }
}
func TestValidSDN(t *testing.T) {
 if err:=Validate(sample());err!=nil {t.Fatal(err)}
}
func TestRejectDuplicateVNI(t *testing.T) {
 c:=sample();c.VNets=append(c.VNets,VNet{ID:"other",ZoneID:"zone1",VNI:10010})
 if Validate(c)==nil {t.Fatal("duplicate VNI accepted")}
}
func TestRejectOverlappingSubnet(t *testing.T) {
 c:=sample();c.Subnets=append(c.Subnets,Subnet{ID:"other",VNetID:"prod",CIDR:"10.10.0.128/25"})
 if Validate(c)==nil {t.Fatal("overlapping subnet accepted")}
}
func TestRejectMissingZone(t *testing.T) {
 c:=sample();c.VNets[0].ZoneID="missing"
 if Validate(c)==nil {t.Fatal("missing zone accepted")}
}
func TestRejectInvalidGateway(t *testing.T) {
 c:=sample();c.Subnets[0].Gateway="192.168.0.1"
 if Validate(c)==nil {t.Fatal("outside gateway accepted")}
}
func TestRejectInvalidVLAN(t *testing.T) {
 c:=sample();c.Zones[0].Type=VLAN;c.VNets[0].VNI=0;c.VNets[0].VLANID=4095
 if Validate(c)==nil {t.Fatal("invalid VLAN accepted")}
}
