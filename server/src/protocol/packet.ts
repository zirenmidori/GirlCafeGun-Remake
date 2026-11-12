export const HEADER_SIZE = 16;
export const MAGIC = 0x88;

export interface GamePacket {
  command: number;
  returnCode: number;
  size: number;
  serial: number;
  compressed: boolean;
  payload: Buffer;
}

export function makePacket(
  command: number,
  serial: number,
  payload: Buffer = Buffer.alloc(0),
  returnCode = 0,
): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(command, 0);
  header.writeUInt16LE(returnCode, 2);
  header.writeUInt32LE(HEADER_SIZE + payload.length, 4);
  header.writeUInt32LE(serial, 8);
  header.writeUInt8(0, 12);
  header.writeUInt8(MAGIC, 13);
  return Buffer.concat([header, payload]);
}

export function readPacket(packet: Buffer): GamePacket {
  if (packet.length < HEADER_SIZE) throw new Error("Packet is shorter than header");
  const size = packet.readUInt32LE(4);
  if (size !== packet.length) {
    throw new Error(`Packet size mismatch: header=${size}, actual=${packet.length}`);
  }
  if (packet.readUInt8(13) !== MAGIC) {
    throw new Error(`Unexpected packet magic: ${packet.readUInt8(13)}`);
  }
  return {
    command: packet.readUInt16LE(0),
    returnCode: packet.readUInt16LE(2),
    size,
    serial: packet.readUInt32LE(8),
    compressed: packet.readUInt8(12) !== 0,
    payload: packet.subarray(HEADER_SIZE),
  };
}
