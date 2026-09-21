import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE, decodeProbe, formatUnits, readProbe } from '../src/chainProbe.js';

const account = () => ({ owner: PROBE.program, executable: false, data: ['Af8GAAAAAADX5PiT/u9o2Ma9hfe5UEwwxsRW463qACcT0ku0BkgedtM/cwIHAAAAAAAAAAAAAAAXbfHOS4oDAAAAAAAAAAAA6RLV1TIDAAAAAAAAAAAAALrSYAYAAAAAAAAAAAAAAADnPhEAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'] });
test('decodes the deployed 128-byte settlement state without floating point loss', () => {
  assert.deepEqual(decodeProbe(account()), { virtualRlo: 30105878483n, tokenReserve: 996483129240855n, modeledSold: 3516870759145n, actualRlo: 107008698n, fees: 1130215n });
  assert.equal(formatUnits(30105878483n, 9), '30.105878483');
  assert.equal(formatUnits(1n, 9), '0.000000001');
  const fixture = account();
  const bytes = Buffer.from(fixture.data[0], 'base64');
  bytes[55] = 1;
  fixture.data[0] = bytes.toString('base64');
  assert.equal(decodeProbe(fixture).virtualRlo, (1n << 120n) + 30105878483n);
});
test('rejects wrong owners, encodings, truncated and uninitialized state', () => {
  assert.throws(() => decodeProbe({ ...account(), owner: 'wrong' }));
  assert.throws(() => decodeProbe({ ...account(), data: ['abc', 'base58'] }));
  assert.throws(() => decodeProbe({ ...account(), data: ['AA==', 'base64'] }));
  assert.throws(() => decodeProbe({ ...account(), data: [Buffer.alloc(128).toString('base64'), 'base64'] }));
});
test('RPC errors cannot be mistaken for a zero balance or healthy state', async () => {
  await assert.rejects(readProbe({ fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(readProbe({ fetcher: async () => ({ ok: true, json: async () => ({ error: { message: 'unavailable' } }) }) }), /unavailable/);
  const data = await readProbe({ fetcher: async () => ({ ok: true, json: async () => ({ result: { value: account() } }) }) });
  assert.equal(data.virtualRlo, 30105878483n);
  assert.equal(PROBE.settlementEnabled, true);
});
