import { describe, expect, it } from "vitest";

import { buildPvpEquipSolution } from "../src/game-data/pvp-solution.js";
import type { Player } from "../src/persistence/player-repository.js";
import {
  PvpSessionManager,
  PVP_ROBOT_ROLE_ID_BASE,
} from "../src/game-data/pvp-session.js";
import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstBytes,
  firstNumber,
  firstString,
} from "../src/protocol/protobuf.js";
import {
  ROOM_CMD_APPLY_PLAYER_INDEX,
  ROOM_CMD_LOADING_END_RSP,
  ROOM_CMD_NOTIFY_OTHER_PLAYER_INDEX,
  ROOM_CMD_NOTIFY_PLAYER_INDEX,
  decodeRoomClientDatagram,
  makeRoomCommand,
  decodePvpCreateTeamRequest,
  decodePvpTeamReadyRequest,
  decodePvpUnityConnect,
  decodePvpUnityPing,
  makePvpCreateTeamResponse,
  makePvpNotifyConnectToPvp,
  makePvpNotifyTeamData,
  makePvpNotifyTeamReadyData,
  makePvpPlayerBaseInfo,
  makePvpPlayerInfo,
  makePvpPlayerList,
  makePvpTeam,
  makePvpUnityPingResponse,
} from "../src/protocol/pvp-messages.js";

const solutionRaw = Buffer.concat([fieldVarint(2, 30000), fieldVarint(4, 1)]);

function makeSelfInfoRaw(): Buffer {
  return makePvpPlayerBaseInfo({
    name: "指挥官",
    level: 60,
    solutionRaw,
    roleId: 1,
    ready: true,
  });
}

describe("pvp messages", () => {
  it("decodes the real client create-team request capture", () => {
    // 实机抓包：mapId=327681, solutionId=4005, isPublic=true, activityId=0,
    // isReady=true。客户端不发送 roleId/PlayerBaseInfo。
    const request = decodePvpCreateTeamRequest(
      Buffer.from("0881801420a51f280130003801", "hex"),
    );
    expect(request).toEqual({
      mapId: 327681,
      solutionId: 4005,
      isPublic: true,
      activityId: 0,
      isReady: true,
    });
  });

  it("encodes create-team response with nested team and players", () => {
    const session = new PvpSessionManager({
      robotCount: 2,
      roomCloseSeconds: 3600,
    }).createTeam({
      roleId: 1,
      name: "指挥官",
      level: 60,
      solutionRaw,
      ready: true,
      mapId: 66060289,
      isPublic: true,
      activityId: 0,
    });
    const teamRaw = makePvpTeam({
      teamId: session.team.teamId,
      leaderId: session.team.leaderId,
      mapId: session.team.mapId,
      playersRaw: session.team.players.map((player) =>
        makePvpPlayerBaseInfo({
          name: player.name,
          level: player.level,
          solutionRaw: player.solutionRaw,
          roleId: player.roleId,
          ready: player.ready,
        }),
      ),
      isPublic: true,
      closeTime: 3600,
      activityId: 0,
      mgrId: 1,
    });
    const team = decodeFields(teamRaw);
    expect(firstNumber(team, 1)).toBe(session.team.teamId);
    expect(firstNumber(team, 2)).toBe(1);
    expect(firstNumber(team, 3)).toBe(66060289);
    const players = team.filter((field) => field.fieldNumber === 4);
    expect(players).toHaveLength(3);
    const robot = decodeFields(players[2]?.value as Buffer);
    expect(firstString(robot, 1)).toBe("AI Teammate 2");
    expect(firstNumber(robot, 4)).toBe(PVP_ROBOT_ROLE_ID_BASE + 1);
    expect(firstNumber(robot, 5)).toBe(1);

    const rsp = decodeFields(
      makePvpCreateTeamResponse({
        teamId: session.team.teamId,
        teamRaw,
        roleId: 1,
        mapId: 66060289,
        activityId: 0,
      }),
    );
    expect(firstNumber(rsp, 1)).toBe(session.team.teamId);
    expect(firstNumber(rsp, 3)).toBe(1);
    expect(firstNumber(rsp, 4)).toBe(66060289);
    expect(firstBytes(rsp, 2)?.equals(teamRaw)).toBe(true);
  });

  it("encodes notify team data and ready data", () => {
    const teamRaw = makePvpTeam({
      teamId: 7,
      leaderId: 1,
      mapId: 66060289,
      playersRaw: [makeSelfInfoRaw()],
      isPublic: false,
      closeTime: 3600,
      activityId: 0,
      mgrId: 1,
    });
    const notify = decodeFields(makePvpNotifyTeamData(1, teamRaw));
    expect(firstNumber(notify, 1)).toBe(1);
    expect(firstBytes(notify, 2)?.equals(teamRaw)).toBe(true);

    const ready = decodeFields(
      makePvpNotifyTeamReadyData({
        roleId: 1,
        whoId: 1,
        whoName: "指挥官",
        players: [
          { roleId: 1, ready: true, isInFormation: false },
          { roleId: PVP_ROBOT_ROLE_ID_BASE, ready: true, isInFormation: false },
        ],
      }),
    );
    expect(firstNumber(ready, 1)).toBe(1);
    const inner = decodeFields(firstBytes(ready, 2) ?? Buffer.alloc(0));
    expect(firstNumber(inner, 1)).toBe(1);
    expect(firstString(inner, 2)).toBe("指挥官");
    const entries = inner.filter((field) => field.fieldNumber === 3);
    expect(entries).toHaveLength(2);
    expect(firstNumber(decodeFields(entries[1]?.value as Buffer), 1)).toBe(
      PVP_ROBOT_ROLE_ID_BASE,
    );
  });

  it("decodes team-ready requests", () => {
    const payload = Buffer.concat([
      fieldVarint(2, 1),
      fieldVarint(3, 0),
      fieldVarint(4, 66060289),
    ]);
    const request = decodePvpTeamReadyRequest(payload);
    expect(request).toEqual({
      ready: true,
      isInFormation: false,
      mapId: 66060289,
    });
  });

  it("encodes the fight-server connect notification and decodes the connect echo", () => {
    const playerListRaw = makePvpPlayerList([
      makePvpPlayerInfo({
        index: 0,
        name: "指挥官",
        camp: 1,
        solutionRaw,
        roleId: 1,
        code: 0,
        serverId: 1,
        level: 60,
      }),
    ]);
    const playerInfo = decodeFields(
      makePvpPlayerInfo({
        index: 0,
        name: "指挥官",
        camp: 1,
        solutionRaw,
        roleId: 1,
        code: 0,
        serverId: 1,
        level: 60,
      }),
    );
    // 原 .proto 字段 3 被删除：camp#4 solution#5 roleId#6 code#7 serverid#8 level#9
    expect(firstNumber(playerInfo, 1)).toBe(0);
    expect(firstString(playerInfo, 2)).toBe("指挥官");
    expect(firstNumber(playerInfo, 4)).toBe(1);
    expect(firstBytes(playerInfo, 5)?.equals(solutionRaw)).toBe(true);
    expect(firstNumber(playerInfo, 6)).toBe(1);
    expect(firstNumber(playerInfo, 9)).toBe(60);

    const notify = decodeFields(
      makePvpNotifyConnectToPvp({
        seed: 42,
        ip: "127.0.0.1",
        port: 30402,
        mapId: 66060289,
        code: 0,
        myIdx: 0,
        reconnect: false,
        roleId: 1,
        playerListRaw,
        roomId: 9,
      }),
    );
    expect(firstNumber(notify, 1)).toBe(42);
    expect(firstString(notify, 2)).toBe("127.0.0.1");
    expect(firstNumber(notify, 3)).toBe(30402);
    expect(firstNumber(notify, 10)).toBe(9);

    const connectReq = Buffer.concat([
      fieldVarint(1, 9),
      fieldVarint(2, 66060289),
      fieldBytes(3, playerListRaw),
      fieldVarint(4, 42),
      fieldVarint(5, 0),
    ]);
    const connect = decodePvpUnityConnect(connectReq);
    expect(connect.roomId).toBe(9);
    expect(connect.mapId).toBe(66060289);
    expect(connect.seed).toBe(42);

    const ping = decodePvpUnityPing(
      Buffer.concat([fieldVarint(1, 5), fieldVarint(2, 9)]),
    );
    expect(ping).toEqual({ frame: 5, roomId: 9 });
    expect(firstNumber(decodeFields(makePvpUnityPingResponse(6)), 1)).toBe(6);
  });
});

describe("pvp session manager", () => {
  it("creates a team with robots and tears it down", () => {
    const manager = new PvpSessionManager({ robotCount: 2, roomCloseSeconds: 3600 });
    const session = manager.createTeam({
      roleId: 1,
      name: "指挥官",
      level: 60,
      solutionRaw,
      ready: true,
      mapId: 66060289,
      isPublic: true,
      activityId: 0,
    });
    expect(session.team.players).toHaveLength(3);
    expect(session.team.players[1]?.isRobot).toBe(true);
    expect(session.team.players[1]?.roleId).toBeGreaterThanOrEqual(
      PVP_ROBOT_ROLE_ID_BASE,
    );

    expect(manager.setReady(1, false, false)).toBe(true);
    expect(session.team.players[0]?.ready).toBe(false);

    expect(manager.kickPlayer(1, PVP_ROBOT_ROLE_ID_BASE)).toBe(true);
    expect(session.team.players).toHaveLength(2);
    expect(manager.kickPlayer(1, 1)).toBe(false);

    const room = manager.createRoom(1);
    expect(room?.mapId).toBe(66060289);
    expect(manager.getSession(1)?.room).toBe(room);

    expect(manager.exitTeam(1)).toBe(true);
    expect(manager.getSession(1)).toBeUndefined();
  });
});

describe("buildPvpEquipSolution", () => {
  it("projects formation cards into solution groups with girl portrait", () => {
    const player = {
      fightPower: 45678,
      inventory: [
        {
          guid: 11,
          genre: 1,
          detail: 3,
          particular: 301,
          templateLevel: 4,
          enhanceLevel: 60,
          breakLevel: 2,
        },
        {
          guid: 12,
          genre: 2,
          detail: 3,
          particular: 88,
          templateLevel: 3,
          enhanceLevel: 40,
          breakLevel: 1,
        },
        {
          guid: 13,
          genre: 1,
          detail: 5,
          particular: 501,
          templateLevel: 3,
          enhanceLevel: 30,
          breakLevel: 0,
        },
      ],
      formations: [
        {
          id: 1,
          title: "初始阵容",
          fightCards: [
            {
              mainCardGuid: 11,
              secondaryCardGuids: [13],
              usedCardGuid: 11,
              weaponGuid: 12,
              runeItemGuids: [],
            },
          ],
        },
      ],
    } as unknown as Player;

    const solution = decodeFields(buildPvpEquipSolution(player));
    expect(firstNumber(solution, 2)).toBe(45678);
    expect(firstNumber(solution, 4)).toBe(3);
    expect(firstNumber(solution, 5)).toBe(1);

    const group = decodeFields(firstBytes(solution, 1) ?? Buffer.alloc(0));
    const mainCard = decodeFields(firstBytes(group, 1) ?? Buffer.alloc(0));
    expect(firstNumber(mainCard, 1)).toBe(1);
    expect(firstNumber(mainCard, 2)).toBe(3);
    expect(firstNumber(mainCard, 3)).toBe(301);
    expect(firstNumber(mainCard, 4)).toBe(4);
    expect(firstNumber(mainCard, 5)).toBe(60);
    expect(firstNumber(mainCard, 6)).toBe(2);
    const weapon = decodeFields(firstBytes(group, 3) ?? Buffer.alloc(0));
    expect(firstNumber(weapon, 1)).toBe(2);
    const deputy = decodeFields(firstBytes(group, 4) ?? Buffer.alloc(0));
    expect(firstNumber(deputy, 2)).toBe(5);
  });

  it("caps teampower when no formation card resolves to avoid client div-by-zero", () => {
    const player = {
      fightPower: 99999,
      inventory: [],
      formations: [],
    } as unknown as Player;

    const solution = decodeFields(buildPvpEquipSolution(player));
    expect(solution.filter((field) => field.fieldNumber === 1)).toHaveLength(0);
    expect(firstNumber(solution, 2)).toBe(8000);
  });
});

describe("room frame protocol", () => {
  it("decodes the real ApplyPlayerIndex datagram capture", () => {
    const datagram = decodeRoomClientDatagram(
      Buffer.from("0300000000000003001d", "hex"),
    );
    expect(datagram).not.toBeNull();
    expect(datagram?.header.toString("hex")).toBe("03000000000000");
    expect(datagram?.commands).toHaveLength(1);
    expect(datagram?.commands[0]?.cmd).toBe(ROOM_CMD_APPLY_PLAYER_INDEX);
    expect(datagram?.commands[0]?.payload).toHaveLength(0);
  });

  it("encodes server room command blocks", () => {
    expect(
      makeRoomCommand(0, ROOM_CMD_NOTIFY_PLAYER_INDEX, Buffer.from([0])).toString(
        "hex",
      ),
    ).toBe("0500001e00");
    expect(makeRoomCommand(0, ROOM_CMD_LOADING_END_RSP).toString("hex")).toBe(
      "04000004",
    );
    expect(
      makeRoomCommand(0, ROOM_CMD_NOTIFY_OTHER_PLAYER_INDEX, Buffer.from([2])).toString(
        "hex",
      ),
    ).toBe("0500001f02");
  });

  it("rejects truncated datagrams", () => {
    expect(decodeRoomClientDatagram(Buffer.from("0300", "hex"))).toBeNull();
    expect(
      decodeRoomClientDatagram(Buffer.from("030000000000000300", "hex")),
    ).toBeNull();
  });
});
