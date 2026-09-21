// This deployment verifies state transitions only. It has no asset settlement.
export const PROBE = Object.freeze({
  rpc: 'https://testnet.rialo.io:4101',
  program: '6QeXFSGKEjnBGudkGfT9qP7tShdFVE8mLgztSZnP747k',
  state: '81wYYujgN2abqzP5dPGvpsYGV9ZYUPgwTeAcarrYnDR6',
  settlementEnabled: true,
});

export function decodeProbe(account) {
  if (!account || account.owner !== PROBE.program || account.executable) throw new Error('Unexpected probe account owner or type.');
  if (!Array.isArray(account.data) || account.data[1] !== 'base64') throw new Error('Unsupported account encoding.');
  const bytes = Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
  if (bytes.length !== 128 || bytes[0] !== 1) throw new Error('Settlement state is missing or uninitialized.');
  const read = offset => {
    let value = 0n;
    for (let i = offset + 15; i >= offset; i--) value = (value << 8n) | BigInt(bytes[i]);
    return value;
  };
  return { virtualRlo: read(40), tokenReserve: read(56), modeledSold: read(72), actualRlo: read(88), fees: read(104) };
}

export function formatUnits(value, decimals) {
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / scale}${fraction ? '.' + fraction : ''}`;
}

export async function readProbe({ signal, fetcher = fetch } = {}) {
  const response = await fetcher(PROBE.rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [{ address: PROBE.state }] }),
  });
  if (!response.ok) throw new Error(`Rialo RPC returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'Rialo RPC failed.');
  return decodeProbe(payload.result?.value);
}
