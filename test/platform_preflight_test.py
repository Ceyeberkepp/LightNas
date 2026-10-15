import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

preflight = load('platform_preflight', 'scripts/platform-preflight.py')
kubernetes = load('kubernetes_installer', 'scripts/install-kubernetes.py')

class PlatformTests(unittest.TestCase):
    def test_all_architectures_keep_the_full_application(self):
        for machine, architecture in [('i686','i386'), ('armv6l','armel'), ('armv7l','armhf'), ('aarch64','arm64'), ('riscv64','riscv64'), ('x86_64','amd64')]:
            with self.subTest(architecture=architecture):
                report = preflight.inspect(machine=machine, architecture=architecture, cpuinfo='', ram_bytes=2048*1024**2)
                self.assertEqual(report['applicationProfile'], 'full')
                self.assertEqual(report['architecture'], architecture)
                self.assertEqual(report['ramMiB'], 2048)
                self.assertEqual(report['qualified'], architecture == 'amd64')

    def test_cpu_flags_are_common_to_every_cpu(self):
        report = preflight.inspect(architecture='i386', cpuinfo='flags : sse sse2\nflags : sse\n')
        self.assertEqual(report['cpuFlags'], ['sse'])

class KubernetesTests(unittest.TestCase):
    def test_supported_server_and_secure_agent(self):
        self.assertRegex(kubernetes.validate({'mode':'server'}, 'arm64', 4096, 2)['sha256'], r'^[a-f0-9]{64}$')
        kubernetes.validate({'mode':'agent','server':'https://192.168.1.2:6443','token':'K10'+'a'*64+'::server:secret'}, 'armhf', 3072, 1)

    def test_rejects_overlap_and_unsafe_join(self):
        cases = [({'clusterCidr':'10.243.0.0/16'}, []), ({}, ['10.242.0.0/24']), ({'mode':'agent','server':'http://server','token':'secret'}, []), ({'mode':'agent','server':'https://user:password@server','token':'K10'+'a'*64+'::secret'}, []), ({'mode':'server','extra':'ignored'}, [])]
        for config, routes in cases:
            with self.subTest(config=config):
                with self.assertRaises(ValueError): kubernetes.validate(config, 'amd64', 4096, 2, routes)

    def test_resources_and_missing_native_artifacts_are_not_faked(self):
        for arch, memory, cores in [('amd64',2048,2), ('amd64',4096,1), ('i386',4096,2), ('riscv64',4096,2)]:
            with self.assertRaises(ValueError): kubernetes.validate({'mode':'server'}, arch, memory, cores)

if __name__ == '__main__': unittest.main()
