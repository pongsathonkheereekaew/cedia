import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dir, "../..");
execFileSync("node", [resolve(root, "scripts/patch-image-size.mjs")]);
const types = resolve(dirname(require.resolve("image-size/package.json")), "dist/types");

test("malformed ICNS and JXL containers terminate within a bounded subprocess", () => {
  const script = `
    const {ICNS}=require(process.argv[1]+'/icns.js');
    const {JXL}=require(process.argv[1]+'/jxl.js');
    const {findBox}=require(process.argv[1]+'/utils.js');
    const assert=require('node:assert/strict');
    const icns=Buffer.alloc(24); icns.write('icns'); icns.writeUInt32BE(24,4); icns.write('icp4',8); icns.writeUInt32BE(8,12); icns.write('icp4',16);
    assert.throws(()=>ICNS.calculate(icns),/entry length/);
    const valid=Buffer.from(icns.subarray(0,16)); valid.writeUInt32BE(16,4); assert.equal(ICNS.calculate(valid).width,16);
    const zero=Buffer.alloc(12); zero.write('jxlp',4); assert.equal(findBox(zero,'jxlp',0).size,12);
    assert.throws(()=>JXL.calculate(zero));
    const small=Buffer.from(zero); small.writeUInt32BE(4); assert.throws(()=>findBox(small,'jxlp',0),/box size/);
    assert.equal(findBox(Buffer.alloc(4),'meta',0),undefined);
  `;
  const result = spawnSync("node", ["-e", script, types], { timeout: 2000, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
});

test("the backport remains idempotent and reads the production app PNG", () => {
  execFileSync("node", [resolve(root, "scripts/patch-image-size.mjs")]);
  const size = require("image-size")(resolve(root, "../../assets/brand/cedia-terminal-d-v1/app-macos.png"));
  expect(size.width).toBe(1024);
  expect(size.height).toBe(1024);
});
