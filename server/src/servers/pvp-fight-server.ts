import { createServer, type Server, type Socket } from "node:net";
import { createSocket, type RemoteInfo, type Socket as UdpSocket } from "node:dgram";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { PvpSessionManager } from "../game-data/pvp-session.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import { HEADER_SIZE, makePacket, readPacket } from "../protocol/packet.js";
import {
  ROOM_CMD_APPLY_PLAYER_INDEX,
  ROOM_CMD_BREATH,
  ROOM_CMD_LOADING,
  ROOM_CMD_LOADING_END,
  ROOM_CMD_LOADING_END_RSP,
  ROOM_CMD_NOTIFY_OTHER_PLAYER_INDEX,
  ROOM_CMD_NOTIFY_PLAYER_INDEX,
  ROOM_CMD_READY,
  decodeRoomClientDatagram,
  makeRoomCommand,
  decodePvpExitFightRoom,
  decodePvpReviveRequest,
  decodePvpUnityConnect,
  decodePvpUnityPing,
  decodePvpWriteLog,
  makePvpExitFightRoomResponse,
  makePvpReviveResponse,
  makePvpUnityGameEndResponse,
  makePvpUnityPingResponse,
} from "../protocol/pvp-messages.js";

interface PvpFightServerOptions {
  config: AppConfig;
  logger: Logger;
  sessions: PvpSessionManager;
}

export interface PvpFightServers {
  tcp: Server;
  udp: UdpSocket;
}

function u16le(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

export function createPvpFightServers(options: PvpFightServerOptions): PvpFightServers {
  const { config, logger, sessions } = options;

  const udp = createSocket("udp4");

  function sendRoomCommands(rinfo: RemoteInfo, blocks: readonly Buffer[]): void {
    const body = Buffer.concat(blocks);
    // UDPClient.ReceiveMessage 校验 (datagramLen - 2) == 首 u16：
    // 服务器数据报以 2 字节总长前缀开头（Frame server HeadLength=2）。
    const datagram = Buffer.concat([u16le(body.length), body]);
    udp.send(datagram, rinfo.port, rinfo.address, (error) => {
      if (error) {
        logger.warn("pvp.fight.udp_send_error", {
          peer: `${rinfo.address}:${rinfo.port}`,
          error: error.message,
        });
        return;
      }
      logger.info("pvp.fight.udp_send", {
        peer: `${rinfo.address}:${rinfo.port}`,
        bytes: datagram.length,
        hex: datagram.toString("hex"),
      });
    });
  }

  udp.on("message", (data, rinfo) => {
    const peer = `${rinfo.address}:${rinfo.port}`;
    const datagram = decodeRoomClientDatagram(data);
    if (!datagram) {
      logger.warn("pvp.fight.udp_bad_datagram", {
        peer,
        bytes: data.length,
        hex: data.toString("hex"),
      });
      return;
    }
    for (const command of datagram.commands) {
      handleRoomCommand(
        rinfo,
        peer,
        datagram.header,
        command.cmd,
        command.payload,
        data,
      );
    }
  });

  function handleRoomCommand(
    rinfo: RemoteInfo,
    peer: string,
    header: Buffer,
    cmd: number,
    payload: Buffer,
    raw: Buffer,
  ): void {
    switch (cmd) {
      case ROOM_CMD_APPLY_PLAYER_INDEX: {
        // 分配玩家序号：房间协议序号从 1 开始（客户端 FindPlayerByIndex
        // 按 players[index-1] 查找，0 直接丢弃），本机玩家固定 1，
        // 机器人依次 2..N+1。随后按正服 ProcessReady 行为下发
        // MessageLoading(cmd=2, mapId u32) 通知客户端进入加载阶段。
        const session = sessions.latestRoomSession();
        const robotCount = session
          ? session.team.players.filter((player) => player.isRobot).length
          : 0;
        logger.info("pvp.fight.apply_player_index", {
          peer,
          headerHex: header.toString("hex"),
          robotCount,
        });
        const blocks: Buffer[] = [
          makeRoomCommand(1, ROOM_CMD_NOTIFY_PLAYER_INDEX, Buffer.from([1])),
        ];
        for (let index = 1; index <= robotCount; index += 1) {
          blocks.push(
            makeRoomCommand(
              1,
              ROOM_CMD_NOTIFY_OTHER_PLAYER_INDEX,
              Buffer.from([index + 1]),
            ),
          );
        }
        const mapId = Buffer.alloc(4);
        mapId.writeUInt32LE(session?.room?.mapId ?? 0, 0);
        blocks.push(makeRoomCommand(1, ROOM_CMD_LOADING, mapId));
        sendRoomCommands(rinfo, blocks);
        return;
      }
      case ROOM_CMD_BREATH: {
        // 心跳：正服 Breath.SendToClient 原样回显 cmd=10 无负载。
        logger.debug("pvp.fight.breath", { peer, headerHex: header.toString("hex") });
        sendRoomCommands(rinfo, [makeRoomCommand(1, ROOM_CMD_BREATH)]);
        return;
      }
      case ROOM_CMD_LOADING_END: {
        // 机器人视为瞬时加载完成：收到客户端 LoadingEnd 立即回
        // LoadingEndRsp，触发客户端 fightStartCall 开战。
        logger.info("pvp.fight.loading_end", {
          peer,
          headerHex: header.toString("hex"),
        });
        sendRoomCommands(rinfo, [makeRoomCommand(1, ROOM_CMD_LOADING_END_RSP)]);
        return;
      }
      case ROOM_CMD_READY: {
        logger.info("pvp.fight.ready", { peer, headerHex: header.toString("hex") });
        return;
      }
      default:
        logger.debug("pvp.fight.room_cmd", {
          peer,
          cmd,
          payloadHex: payload.toString("hex"),
          headerHex: header.toString("hex"),
          bytes: raw.length,
        });
    }
  }

  udp.on("error", (error) => {
    logger.warn("pvp.fight.udp_error", { error: error.message });
  });
  udp.on("listening", () => {
    const address = udp.address();
    logger.info("pvp.fight.udp_listening", {
      address: `${address.address}:${address.port}`,
    });
  });

  const tcp = createServer((socket: Socket) => {
    const peer = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`;
    let pending = Buffer.alloc(0);
    let roomId = 0;
    logger.info("pvp.fight.connected", { peer });

    function send(
      command: number,
      serial: number,
      payload: Buffer = Buffer.alloc(0),
    ): void {
      const packet = makePacket(command, serial, payload);
      socket.write(packet);
      logger.debug("pvp.fight.send", {
        peer,
        command,
        commandName: commandName(command),
        serial,
        packetBytes: packet.length,
        packetHex: packet.toString("hex"),
      });
    }

    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= HEADER_SIZE) {
        const packetSize = pending.readUInt32LE(4);
        if (packetSize < HEADER_SIZE || packetSize > config.gateway.maxPacketBytes) {
          logger.error("pvp.fight.invalid_packet_size", { peer, packetSize });
          socket.destroy();
          return;
        }
        if (pending.length < packetSize) break;
        const raw = pending.subarray(0, packetSize);
        pending = pending.subarray(packetSize);
        try {
          handlePacket(raw);
        } catch (error) {
          logger.error("pvp.fight.handle_failed", {
            peer,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    function handlePacket(raw: Buffer): void {
      const packet = readPacket(raw);
      logger.info("pvp.fight.recv", {
        peer,
        command: packet.command,
        commandName: commandName(packet.command),
        serial: packet.serial,
        payloadBytes: packet.payload.length,
        payloadHex: packet.payload.toString("hex"),
      });

      switch (packet.command) {
        case COMMAND.PVP_UNITY_CONNECT_TO_PVP_REQ: {
          const request = decodePvpUnityConnect(packet.payload);
          roomId = request.roomId;
          logger.info("pvp.fight.connect", { peer, ...request, playersRaw: undefined });
          // 1701 与 1700 同为 UnityApplyConnectToPvp：回显客户端字段。
          send(COMMAND.PVP_UNITY_CONNECT_TO_PVP_RSP, packet.serial, packet.payload);
          return;
        }
        case COMMAND.PVP_UNITY_PING_REQ: {
          const request = decodePvpUnityPing(packet.payload);
          send(
            COMMAND.PVP_UNITY_PING_RSP,
            packet.serial,
            makePvpUnityPingResponse(request.frame + 1),
          );
          return;
        }
        case COMMAND.PVP_UNITY_GAME_END_REQ: {
          send(
            COMMAND.PVP_UNITY_GAME_END_RSP,
            packet.serial,
            makePvpUnityGameEndResponse(roomId),
          );
          return;
        }
        case COMMAND.PVP_APPLY_EXIT_FIGHT_ROOM_REQ: {
          const request = decodePvpExitFightRoom(packet.payload);
          send(
            COMMAND.PVP_APPLY_EXIT_FIGHT_ROOM_RSP,
            packet.serial,
            makePvpExitFightRoomResponse(request.roleId),
          );
          return;
        }
        case COMMAND.PVP_UNITY_REVIVE_REQ: {
          const request = decodePvpReviveRequest(packet.payload);
          send(
            COMMAND.PVP_UNITY_REVIVE_RSP,
            packet.serial,
            makePvpReviveResponse({
              roleId: request.roleId,
              money: request.money,
              success: true,
              roomId: request.roomId,
            }),
          );
          return;
        }
        case COMMAND.PVP_UNITY_WRITE_LOG: {
          const request = decodePvpWriteLog(packet.payload);
          logger.info("pvp.fight.client_log", { peer, ...request });
          return;
        }
        default:
          logger.warn("pvp.fight.unhandled", {
            peer,
            command: packet.command,
            commandName: commandName(packet.command),
            serial: packet.serial,
            payloadHex: packet.payload.toString("hex"),
          });
      }
    }

    socket.on("error", (error) => {
      logger.warn("pvp.fight.socket_error", { peer, error: error.message });
    });
    socket.on("close", () => {
      logger.info("pvp.fight.closed", { peer, roomId });
    });
  });

  return { tcp, udp };
}
