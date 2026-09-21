import assert from "node:assert/strict";
import test from "node:test";
import { encodeGraduate, encodeInitializeAndBuy, rloToKelvin, tokenToBaseUnits } from "../src/rialofunInstruction.js";

test("encodes InitializeAndBuy with the Rust tag and little-endian u128 amounts", () => {
  const bytes = encodeInitializeAndBuy({ initialBuyRlo: "2", minTokensOut: "9.999999" });
  assert.equal(bytes.length, 33);
  assert.equal(bytes[0], 0);
  assert.deepEqual([...bytes.slice(1, 5)], [0, 148, 53, 119]); // 2 RLO in Kelvin, little endian
  assert.equal(rloToKelvin("0.000000001"), 1n);
  assert.equal(tokenToBaseUnits("9.999999"), 9_999_999n);
});

test("keeps Graduate a single explicit byte", () => {
  assert.deepEqual([...encodeGraduate()], [3]);
});
