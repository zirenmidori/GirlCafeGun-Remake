import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstBytes,
  firstNumber,
  firstString,
} from "./protobuf.js";

// pvpproto 消息编解码。字段编号依据 il2cpp dump 中 C# 字段声明顺序按 1..N
// 顺序编号（手写序列化器，dump 无 ProtoMember 标签），已通过客户端真实
// 1627 请求解析验证。

export interface PvpCreateTeamRequest {
  mapId: number;
  solutionId: number;
  isPublic: boolean;
  activityId: number;
  isReady: boolean;
}

export interface PvpTeamReadyRequest {
  ready: boolean;
  isInFormation: boolean;
  mapId: number;
}

export interface PvpUnityConnectRequest {
  roomId: number;
  mapId: number;
  playersRaw: Buffer | undefined;
  seed: number;
  isPublic: boolean;
}

export interface PvpReviveRequest {
  roleId: number;
  money: number;
  count: number;
  roomId: number;
}

// 客户端 ApplyCreateTeamReq 只发 mapId/solutionId/isPublic/activityId/isReady
// （roleId 与 PlayerBaseInfo 由服务器按会话补充），真实抓包示例：
// 0881801420a51f280130003801（mapId=327681 solutionId=4005）。
export function decodePvpCreateTeamRequest(payload: Buffer): PvpCreateTeamRequest {
  const fields = decodeFields(payload);
  return {
    mapId: firstNumber(fields, 1),
    solutionId: firstNumber(fields, 4),
    isPublic: firstNumber(fields, 5) !== 0,
    activityId: firstNumber(fields, 6),
    isReady: firstNumber(fields, 7) !== 0,
  };
}

export function decodePvpTeamReadyRequest(payload: Buffer): PvpTeamReadyRequest {
  const fields = decodeFields(payload);
  return {
    ready: firstNumber(fields, 2) !== 0,
    isInFormation: firstNumber(fields, 3) !== 0,
    mapId: firstNumber(fields, 4),
  };
}

export function decodePvpBeginMatchRequest(payload: Buffer): {
  mapId: number;
  activityId: number;
} {
  const fields = decodeFields(payload);
  return {
    mapId: firstNumber(fields, 1),
    activityId: firstNumber(fields, 6),
  };
}

export function decodePvpRoomPublic(payload: Buffer): {
  roleId: number;
  isPublic: boolean;
} {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    isPublic: (firstNumber(fields, 2) ?? 0) !== 0,
  };
}

export function decodePvpEmoji(payload: Buffer): {
  roleId: number;
  emojiIndex: number;
} {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    emojiIndex: firstNumber(fields, 2) ?? 0,
  };
}

export function decodePvpKicking(payload: Buffer): {
  roleId: number;
  memId: number;
} {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    memId: firstNumber(fields, 2) ?? 0,
  };
}

export function decodePvpUnityConnect(payload: Buffer): PvpUnityConnectRequest {
  const fields = decodeFields(payload);
  return {
    roomId: firstNumber(fields, 1) ?? 0,
    mapId: firstNumber(fields, 2) ?? 0,
    playersRaw: firstBytes(fields, 3),
    seed: firstNumber(fields, 4) ?? 0,
    isPublic: (firstNumber(fields, 5) ?? 0) !== 0,
  };
}

export function decodePvpUnityPing(payload: Buffer): {
  frame: number;
  roomId: number;
} {
  const fields = decodeFields(payload);
  return {
    frame: firstNumber(fields, 1) ?? 0,
    roomId: firstNumber(fields, 2) ?? 0,
  };
}

export function decodePvpReviveRequest(payload: Buffer): PvpReviveRequest {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    money: firstNumber(fields, 2) ?? 0,
    count: firstNumber(fields, 3) ?? 0,
    roomId: firstNumber(fields, 4) ?? 0,
  };
}

export function decodePvpExitFightRoom(payload: Buffer): {
  roleId: number;
  roomId: number;
  shouldClose: number;
} {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    roomId: firstNumber(fields, 2) ?? 0,
    shouldClose: firstNumber(fields, 3) ?? 0,
  };
}

export function decodePvpWriteLog(payload: Buffer): {
  roleId: number;
  logType: number;
  msg: string;
  roomId: number;
} {
  const fields = decodeFields(payload);
  return {
    roleId: firstNumber(fields, 1) ?? 0,
    logType: firstNumber(fields, 2) ?? 0,
    msg: firstString(fields, 3) ?? "",
    roomId: firstNumber(fields, 4) ?? 0,
  };
}

export function makePvpPlayerBaseInfo(options: {
  name: string;
  level: number;
  solutionRaw: Buffer;
  roleId: number;
  ready: boolean;
  isInFormation?: boolean;
}): Buffer {
  return Buffer.concat([
    fieldBytes(1, options.name),
    fieldVarint(2, options.level),
    fieldBytes(3, options.solutionRaw),
    fieldVarint(4, options.roleId),
    fieldVarint(5, options.ready ? 1 : 0),
    fieldVarint(6, options.isInFormation ? 1 : 0),
  ]);
}

export function makePvpTeam(options: {
  teamId: number;
  leaderId: number;
  mapId: number;
  playersRaw: readonly Buffer[];
  isPublic: boolean;
  closeTime: number;
  activityId: number;
  mgrId: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.teamId),
    fieldVarint(2, options.leaderId),
    fieldVarint(3, options.mapId),
    ...options.playersRaw.map((player) => fieldBytes(4, player)),
    fieldVarint(5, options.isPublic ? 1 : 0),
    fieldVarint(6, options.closeTime),
    fieldVarint(8, options.activityId),
    fieldVarint(9, options.mgrId),
  ]);
}

export function makePvpCreateTeamResponse(options: {
  teamId: number;
  teamRaw: Buffer;
  roleId: number;
  mapId: number;
  activityId: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.teamId),
    fieldBytes(2, options.teamRaw),
    fieldVarint(3, options.roleId),
    fieldVarint(4, options.mapId),
    fieldVarint(5, options.activityId),
  ]);
}

export function makePvpNotifyTeamData(roleId: number, teamRaw: Buffer): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldBytes(2, teamRaw)]);
}

// NotifyTeamReadyData{roleId#1, team#2 TeamReadyData{whoId#1, whoName#2,
// players#3 repeated PlayerReadyData{roleId#1, ready#2, IsInFormation#3}}}
export function makePvpNotifyTeamReadyData(options: {
  roleId: number;
  whoId: number;
  whoName: string;
  players: readonly { roleId: number; ready: boolean; isInFormation: boolean }[];
}): Buffer {
  const inner = Buffer.concat([
    fieldVarint(1, options.whoId),
    fieldBytes(2, options.whoName),
    ...options.players.map((player) =>
      fieldBytes(
        3,
        Buffer.concat([
          fieldVarint(1, player.roleId),
          fieldVarint(2, player.ready ? 1 : 0),
          fieldVarint(3, player.isInFormation ? 1 : 0),
        ]),
      ),
    ),
  ]);
  return Buffer.concat([fieldVarint(1, options.roleId), fieldBytes(2, inner)]);
}

export function makePvpTeamReadyResponse(roleId: number, ret: boolean): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret ? 1 : 0)]);
}

export function makePvpExitTeamResponse(roleId: number, ret = 0): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret)]);
}

export function makePvpTeamDataResponse(
  roleId: number,
  teamRaw: Buffer | null,
): Buffer {
  if (teamRaw === null) return fieldVarint(1, roleId);
  return Buffer.concat([fieldVarint(1, roleId), fieldBytes(2, teamRaw)]);
}

export function makePvpUpdatePlayerInfoResponse(roleId: number, ret = 0): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret)]);
}

export function makePvpPingMgrResponse(ret = 0): Buffer {
  return fieldVarint(1, ret);
}

export function makePvpCheckRoomResponse(roleId: number): Buffer {
  return fieldVarint(1, roleId);
}

export function makePvpBeginMatchResponse(options: {
  mapId: number;
  roleId: number;
  ret: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.mapId),
    fieldVarint(2, options.roleId),
    fieldVarint(3, options.ret),
  ]);
}

export function makePvpEndMatchResponse(roleId: number, ret = 0): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret)]);
}

export function makePvpNotifyRoomPublicAttr(roleId: number, isPublic: boolean): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, isPublic ? 1 : 0)]);
}

export function makePvpNotifyEmoji(options: {
  roleId: number;
  sendId: number;
  emojiIndex: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.roleId),
    fieldVarint(2, options.sendId),
    fieldVarint(3, options.emojiIndex),
  ]);
}

export function makePvpZanResponse(roleId: number, ret = 0): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret)]);
}

export function makePvpKickingResponse(options: {
  roleId: number;
  memId: number;
  ret?: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.roleId),
    fieldVarint(2, options.memId),
    fieldVarint(3, options.ret ?? 0),
  ]);
}

// PlayerInfo 字段编号有断层（原 .proto 字段 3 被删除/保留），经 libil2cpp
// Parse 反汇编确认：index#1 name#2 camp#4 solution#5 roleId#6 code#7
// serverid#8 level#9。其余 pvpproto 消息均为顺序编号。
export function makePvpPlayerInfo(options: {
  index: number;
  name: string;
  camp: number;
  solutionRaw: Buffer;
  roleId: number;
  code: number;
  serverId: number;
  level: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.index),
    fieldBytes(2, options.name),
    fieldVarint(4, options.camp),
    fieldBytes(5, options.solutionRaw),
    fieldVarint(6, options.roleId),
    fieldVarint(7, options.code),
    fieldVarint(8, options.serverId),
    fieldVarint(9, options.level),
  ]);
}

export function makePvpPlayerList(playersRaw: readonly Buffer[]): Buffer {
  return Buffer.concat(playersRaw.map((player) => fieldBytes(1, player)));
}

export function makePvpNotifyConnectToPvp(options: {
  seed: number;
  ip: string;
  port: number;
  mapId: number;
  code: number;
  myIdx: number;
  reconnect: boolean;
  roleId: number;
  playerListRaw: Buffer;
  roomId: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.seed),
    fieldBytes(2, options.ip),
    fieldVarint(3, options.port),
    fieldVarint(4, options.mapId),
    fieldVarint(5, options.code),
    fieldVarint(6, options.myIdx),
    fieldVarint(7, options.reconnect ? 1 : 0),
    fieldVarint(8, options.roleId),
    fieldBytes(9, options.playerListRaw),
    fieldVarint(10, options.roomId),
  ]);
}

export function makePvpUnityPingResponse(frame: number): Buffer {
  return fieldVarint(1, frame);
}

export function makePvpUnityGameEndResponse(roomId: number): Buffer {
  return fieldVarint(1, roomId);
}

export function makePvpReviveResponse(options: {
  roleId: number;
  money: number;
  success: boolean;
  roomId: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.roleId),
    fieldVarint(2, options.money),
    fieldVarint(3, options.success ? 1 : 0),
    fieldVarint(4, options.roomId),
  ]);
}

export function makePvpExitFightRoomResponse(roleId: number, ret = 0): Buffer {
  return Buffer.concat([fieldVarint(1, roleId), fieldVarint(2, ret)]);
}

export function makePvpNotifyEnterLevel(options: {
  roleId: number;
  mapId: number;
  roomId: number;
  battleGroupId: number;
}): Buffer {
  return Buffer.concat([
    fieldVarint(1, options.roleId),
    fieldVarint(2, options.mapId),
    fieldVarint(3, options.roomId),
    fieldVarint(4, options.battleGroupId),
  ]);
}

// Online 房间帧同步协议（UDP），格式经 libil2cpp 反汇编确认：
// - 客户端→服务器：7 字节头 + 命令块序列，块为 [u16 len][u8 cmd][payload]，
//   len 含自身 2 字节（实机抓包 0300000000000003001d = ApplyPlayerIndex）；
// - 服务器→客户端：命令块序列，块为 [u16 len][u8 playerIndex][u8 cmd]
//   [payload]，len 含 4 字节头（ClientRoom.ProcessMsg 逐块解析）；
// - cmd 枚举见 dump.cs Online.Command。
export const ROOM_HEADER_CLIENT = 7;
export const ROOM_CMD_READY = 1;
export const ROOM_CMD_LOADING = 2;
export const ROOM_CMD_LOADING_END = 3;
export const ROOM_CMD_LOADING_END_RSP = 4;
export const ROOM_CMD_BREATH = 10;
export const ROOM_CMD_APPLY_PLAYER_INDEX = 29;
export const ROOM_CMD_NOTIFY_PLAYER_INDEX = 30;
export const ROOM_CMD_NOTIFY_OTHER_PLAYER_INDEX = 31;

export interface RoomCommand {
  cmd: number;
  payload: Buffer;
}

export function makeRoomCommand(
  playerIndex: number,
  cmd: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  const block = Buffer.alloc(4 + payload.length);
  block.writeUInt16LE(4 + payload.length, 0);
  block.writeUInt8(playerIndex, 2);
  block.writeUInt8(cmd, 3);
  payload.copy(block, 4);
  return block;
}

// 解析客户端 UDP 数据报：返回 7 字节头和命令块序列；格式非法返回 null。
export function decodeRoomClientDatagram(data: Buffer): {
  header: Buffer;
  commands: RoomCommand[];
} | null {
  if (data.length < ROOM_HEADER_CLIENT + 3) return null;
  const commands: RoomCommand[] = [];
  let offset = ROOM_HEADER_CLIENT;
  while (offset + 3 <= data.length) {
    const len = data.readUInt16LE(offset);
    if (len < 3 || offset + len > data.length) return null;
    commands.push({
      cmd: data.readUInt8(offset + 2),
      payload: data.subarray(offset + 3, offset + len),
    });
    offset += len;
  }
  return { header: data.subarray(0, ROOM_HEADER_CLIENT), commands };
}
