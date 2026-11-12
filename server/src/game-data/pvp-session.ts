// 联机协同作战会话状态：内存态，不持久化。离线服只有一名真实玩家，
// 其余队友由服务器伪造机器人（roleId >= 200000000 时客户端按机器人渲染，
// 见 UI_CreateTeam.lua 的 ShowRobotInfo 分支），编队数据直接复用玩家本人
// 请求里携带的 solution 原始字节，避免客户端按空编队计算战力时出现除零。

export const PVP_ROBOT_ROLE_ID_BASE = 200_000_001;

export interface PvpTeamPlayer {
  roleId: number;
  name: string;
  level: number;
  ready: boolean;
  isInFormation: boolean;
  isRobot: boolean;
  solutionRaw: Buffer;
}

export interface PvpTeam {
  teamId: number;
  leaderId: number;
  mapId: number;
  isPublic: boolean;
  closeTime: number;
  activityId: number;
  mgrId: number;
  players: PvpTeamPlayer[];
}

export interface PvpRoom {
  roomId: number;
  mapId: number;
  seed: number;
  startedAt: number;
}

export interface PvpSession {
  team: PvpTeam;
  room: PvpRoom | null;
}

export interface PvpSessionManagerOptions {
  robotCount: number;
  roomCloseSeconds: number;
}

export class PvpSessionManager {
  readonly #options: PvpSessionManagerOptions;
  readonly #sessions = new Map<number, PvpSession>();
  #nextTeamId = 1;
  #nextRoomId = 1;

  constructor(options: PvpSessionManagerOptions) {
    this.#options = options;
  }

  createTeam(self: {
    roleId: number;
    name: string;
    level: number;
    solutionRaw: Buffer;
    ready: boolean;
    mapId: number;
    isPublic: boolean;
    activityId: number;
  }): PvpSession {
    const players: PvpTeamPlayer[] = [
      {
        roleId: self.roleId,
        name: self.name,
        level: self.level,
        ready: self.ready,
        isInFormation: false,
        isRobot: false,
        solutionRaw: self.solutionRaw,
      },
    ];
    for (let index = 0; index < this.#options.robotCount; index += 1) {
      players.push({
        roleId: PVP_ROBOT_ROLE_ID_BASE + index,
        name: `AI Teammate ${index + 1}`,
        level: self.level,
        ready: true,
        isInFormation: false,
        isRobot: true,
        solutionRaw: self.solutionRaw,
      });
    }
    const session: PvpSession = {
      team: {
        teamId: this.#nextTeamId++,
        leaderId: self.roleId,
        mapId: self.mapId,
        isPublic: self.isPublic,
        closeTime: this.#options.roomCloseSeconds,
        activityId: self.activityId,
        mgrId: 1,
        players,
      },
      room: null,
    };
    this.#sessions.set(self.roleId, session);
    return session;
  }

  getSession(roleId: number): PvpSession | undefined {
    return this.#sessions.get(roleId);
  }

  exitTeam(roleId: number): boolean {
    return this.#sessions.delete(roleId);
  }

  setReady(roleId: number, ready: boolean, isInFormation: boolean): boolean {
    const session = this.#sessions.get(roleId);
    if (!session) return false;
    const player = session.team.players.find((entry) => entry.roleId === roleId);
    if (!player) return false;
    player.ready = ready;
    player.isInFormation = isInFormation;
    return true;
  }

  setPublic(roleId: number, isPublic: boolean): boolean {
    const session = this.#sessions.get(roleId);
    if (!session) return false;
    session.team.isPublic = isPublic;
    return true;
  }

  updateSelfSolution(roleId: number, solutionRaw: Buffer): boolean {
    const session = this.#sessions.get(roleId);
    if (!session) return false;
    const player = session.team.players.find((entry) => entry.roleId === roleId);
    if (!player) return false;
    if (solutionRaw.length > 0) player.solutionRaw = solutionRaw;
    return true;
  }

  kickPlayer(roleId: number, memId: number): boolean {
    const session = this.#sessions.get(roleId);
    if (!session || session.team.leaderId !== roleId) return false;
    const before = session.team.players.length;
    session.team.players = session.team.players.filter(
      (entry) => entry.roleId !== memId || !entry.isRobot,
    );
    return session.team.players.length !== before;
  }

  createRoom(roleId: number): PvpRoom | null {
    const session = this.#sessions.get(roleId);
    if (!session) return null;
    const room: PvpRoom = {
      roomId: this.#nextRoomId++,
      mapId: session.team.mapId,
      seed: Math.floor(Math.random() * 0x7fffffff),
      startedAt: Date.now(),
    };
    session.room = room;
    return room;
  }

  // 战斗 UDP 通道没有登录上下文，离线服单玩家直接取最新已开房的会话。
  latestRoomSession(): PvpSession | undefined {
    let latest: PvpSession | undefined;
    for (const session of this.#sessions.values()) {
      if (!session.room) continue;
      if (!latest || (latest.room?.startedAt ?? 0) < session.room.startedAt) {
        latest = session;
      }
    }
    return latest;
  }
}
