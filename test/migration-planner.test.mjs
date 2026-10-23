import test from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATION_SOURCES, supportedMigrationSources, planMigration } from '../src/migration-planner.mjs';

test('four separate source profiles support virtualization, network and storage discovery', () => {
  assert.deepEqual(Object.keys(MIGRATION_SOURCES), ['vmware', 'proxmox', 'truenas', 'redhat']);
  for (const source of supportedMigrationSources()) {
    assert.ok(source.discovery.length >= 6);
    assert.ok(source.adapters.length >= 3);
    assert.ok(source.constraints.length >= 2);
  }
});

test('inventory planning does not execute transfer or tracking', () => {
  const result = planMigration({
    source: 'proxmox',
    items: [
      { id: '101', name: 'Production VM', type: 'vm' },
      { id: 'br0', name: 'Main bridge', type: 'network' }
    ],
    mappings: { '101': { target: 'local-vm-pool' } }
  });
  assert.equal(result.migrationStarted, false);
  assert.equal(result.transmitsTelemetry, false);
  assert.equal(result.trackingPixels, false);
  assert.deepEqual(result.blockers, ['br0']);
  assert.equal(result.steps[0].status, 'ready-for-review');
  assert.equal(result.steps[1].status, 'needs-mapping');
  assert.ok(result.steps.every(step => step.automaticCutover === false));
});

test('rejects unsupported imports, duplicate IDs and invalid maps', () => {
  assert.throws(() => planMigration({ source: 'unknown', items: [] }), /unsupported/);
  assert.throws(() => planMigration({ source: 'vmware', items: [{ id: 'a', name: 'VM', type: 'vm' }, { id: 'a', name: 'Copy', type: 'vm' }] }), /duplicate/);
  assert.throws(() => planMigration({ source: 'truenas', items: [{ id: 'a', name: 'Pool', type: 'storage' }], mappings: { a: 'unsafe' } }), /mapping/);
});
