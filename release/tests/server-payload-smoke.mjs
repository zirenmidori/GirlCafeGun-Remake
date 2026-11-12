import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const [payload, stable] = process.argv.slice(2);
await mkdir(stable, { recursive: true });
const state = path.join(stable, "state.json");
const log = path.join(stable, "server.log");
const { COMMAND } = await import(pathToFileURL(path.join(payload, "dist/protocol/commands.js")));
const { makePacket, readPacket, HEADER_SIZE } = await import(pathToFileURL(path.join(payload, "dist/protocol/packet.js")));
const { fieldBytes, fieldVarint, decodeFields, firstNumber } = await import(pathToFileURL(path.join(payload, "dist/protocol/protobuf.js")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function request(socket, command, serial, body, response) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0); const packets = [];
    const timeout = setTimeout(() => finish(new Error("Packet timeout")), 5000);
    function finish(error) {
      clearTimeout(timeout); socket.off("data", onData); socket.off("error", finish);
      if (error) reject(error); else resolve(packets);
    }
    function onData(chunk) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_SIZE) {
        const size = pending.readUInt32LE(4); if (pending.length < size) return;
        const packet = readPacket(pending.subarray(0, size)); pending = pending.subarray(size); packets.push(packet);
        if (packet.command === response && packet.serial === serial) { finish(); return; }
      }
    }
    socket.on("data", onData); socket.once("error", finish);
    socket.write(makePacket(command, serial, body));
  });
}
const rounds = [];
for (let round = 0; round < 2; round++) {
  let output = "";
  const child = spawn(process.execPath, [path.join(payload, "bootstrap.mjs"), state, log], {
    cwd: payload, windowsHide: true,
    env: { ...process.env, TEMP: stable, TMP: stable, NODE_COMPILE_CACHE: path.join(stable, "compile-cache") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let socket;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      if (output.includes("server.started")) break;
      await sleep(100);
    }
    assert(output.includes("server.started"), output);
    const list = await (await fetch("http://127.0.0.1:28080/serverlist")).json();
    assert.equal(list.serverlist[0].ip, "127.0.0.1");
    assert.deepEqual(list.serverlist[0].port, [31400]);
    socket = createConnection({ host: "127.0.0.1", port: 31400 }); await once(socket, "connect");
    const verify = await request(socket, COMMAND.VERIFY_REQ, 1, fieldBytes(2, round ? "different" : "GM:legacy"), COMMAND.VERIFY_RSP);
    assert.equal(firstNumber(decodeFields(verify.at(-1).payload), 1), 1);
    assert.equal(firstNumber(decodeFields(verify.at(-1).payload), 9), round ? 0 : 1);
    await request(socket, COMMAND.LOGIN_REQ, 2, fieldBytes(1, "ignored"), COMMAND.LOGIN_RSP);
    let saved = JSON.parse(await readFile(state, "utf8"));
    assert.deepEqual(Object.keys(saved.players), ["gcg-offline-player-v1"]);
    let player = saved.players["gcg-offline-player-v1"];
    if (round === 0) {
      assert(!player.inventory.some((i) => i.detail === 27));
      const mail = player.mail.messages.find((m) => m.title === "Welcome to Girl Cafe Gun");
      assert(mail);
      const claim = await request(socket, COMMAND.GET_MAIL_ITEM_REQ, 3,
        Buffer.concat([fieldVarint(1, mail.id), fieldVarint(2, 1)]), COMMAND.GET_MAIL_ITEM_RSP);
      assert(claim.some((packet) => packet.command === COMMAND.GIRL_UPDATE_NTF));
      saved = JSON.parse(await readFile(state, "utf8")); player = saved.players["gcg-offline-player-v1"];
    }
    for (const gdpl of [[1,27,1,1], [2,2,28,1]]) {
      const gifts = player.inventory.filter((i) => [i.genre,i.detail,i.particular,i.templateLevel].every((n,k) => n === gdpl[k]));
      assert.equal(gifts.length, 1); assert.equal(gifts[0].enhanceLevel, 1); assert.equal(gifts[0].breakLevel, 0);
    }
    assert(player.girls.some((g) => g.girlId === 27));
    assert(!player.mail.messages.some((m) => m.title === "Welcome to Girl Cafe Gun"));
    rounds.push({ round, roleId: player.roleId, oneAccount: true, oneBaseLevelCopyPerGift: true, welcomeNotReseeded: true });
  } finally {
    socket?.destroy(); child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
}
console.log(JSON.stringify({ success: true, cleanPayloadBootedTwice: true, rounds }));
