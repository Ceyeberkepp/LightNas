# LightNAS ISO networking

The Debian graphical installer (LightNAS branded boot menu) detects supported
wired and wireless adapters through kernel drivers and firmware. DHCP is
attempted automatically; the operator can still choose manual networking if
DHCP fails. The installer asks for hostname and domain. A valid hostname label
permits a hyphen between alphanumeric characters; periods separate FQDN labels.

After boot, inspect real values (no guessed IP addresses):

```bash
sudo python3 /opt/lightnas/scripts/lightnas-network-setup.py
sudo python3 /opt/lightnas/scripts/lightnas-network-setup.py --json
```

The report lists physical Ethernet and Wi-Fi interfaces known to NetworkManager,
IPv4 addresses, default gateway, assigned DNS servers and visible Wi-Fi SSIDs.
Not all Wi-Fi adapters work without the correct firmware; SSIDs also require
being in range. Wi-Fi needs authentication and cannot normally serve as a
transparent guest Ethernet bridge.

To explicitly apply DHCP on an interface:

```bash
sudo python3 /opt/lightnas/scripts/lightnas-network-setup.py \
  --apply --interface enp1s0 --method dhcp --fqdn lightnas.lab.example
```

For manual IPv4 settings:

```bash
sudo python3 /opt/lightnas/scripts/lightnas-network-setup.py \
  --apply --interface enp1s0 --method static \
  --address 192.168.1.25/24 --gateway 192.168.1.1 \
  --dns 192.168.1.1 1.1.1.1 --fqdn lightnas.lab.example
```

For Wi-Fi, use `--apply --interface wlan0 --ssid YOUR_NETWORK`;
NetworkManager requests authentication interactively. The helper does not
write passwords into LightNAS logs.

Changing live management networking can disconnect an SSH session. Perform
network cutovers from the appliance console. DHCP gateway and DNS values are
read from the actual lease, not filled with made-up defaults.

The current ISO remains Debian Installer-based. A fully custom graphical
Proxmox-like installation wizard has not yet replaced Debian's screens.
Physical NIC firmware, BIOS/UEFI boot, wireless connection, FQDN and IPv4
configuration must be validated in booted hardware/VM before release.
