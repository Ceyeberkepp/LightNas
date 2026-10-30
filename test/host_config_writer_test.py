import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('host_agent_config_test', Path(__file__).resolve().parents[1] / 'scripts/lightnas-host-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class HostConfigWriterTests(unittest.TestCase):
    def test_supported_resource_and_network_values_remain_usable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config'
            lines = ['lxc.cgroup2.memory.max = 2147483648', 'lxc.cgroup2.cpu.max = 200000 100000',
                     'lxc.net.0.type = macvlan', 'lxc.net.0.macvlan.mode = bridge',
                     'lxc.net.1.type = ipvlan', 'lxc.net.1.ipvlan.mode = l2',
                     'lxc.net.2.type = veth', 'lxc.net.2.link = enp1s0.20',
                     'lxc.net.2.name = eth2', 'lxc.net.2.flags = up',
                     'lxc.net.2.vlan.id = 4094', 'lxc.net.2.hwaddr = 02:ab:cd:ef:00:01',
                     'lxc.apparmor.profile = unconfined']
            for line in lines:
                agent.append_unique(path, line)
            self.assertEqual(path.read_text().splitlines(), lines)

    def test_updates_only_selected_setting_and_restricts_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config'
            path.write_text('lxc.start.auto = 0\nlxc.net.0.link = eth0\n')
            path.chmod(0o644)
            agent.append_unique(path, 'lxc.start.auto = 1')
            self.assertEqual(path.read_text(), 'lxc.net.0.link = eth0\nlxc.start.auto = 1\n')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_rejects_credentials_multiline_input_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config'
            for line in ['password = test', 'lxc.start.auto = 1\npassword = test',
                         'lxc.net.0.link = eth0\r', 'lxc.net.0.type = arbitrary',
                         'lxc.net.0.vlan.id = 4095']:
                with self.subTest(line=line), self.assertRaises(ValueError):
                    agent.append_unique(path, line)
            self.assertFalse(path.exists())
            target = Path(directory) / 'target'
            target.write_text('unchanged')
            path.symlink_to(target)
            with self.assertRaises(OSError):
                agent.append_unique(path, 'lxc.start.auto = 1')
            self.assertEqual(target.read_text(), 'unchanged')
