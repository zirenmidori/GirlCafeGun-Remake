export const LUA_COMMAND_WRITE_GUIDE_LOG = 102;

export interface GuideLogAcknowledgement {
  nTimming: number;
  GuideId: number | string;
  StepId: number;
  GuideType: string;
}

export function makeGuideLogAcknowledgement(
  parameters: unknown,
): GuideLogAcknowledgement | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const wrapper = parameters as Record<string, unknown>;
  if (typeof wrapper.tbParam !== "object" || wrapper.tbParam === null) return null;
  const guide = wrapper.tbParam as Record<string, unknown>;

  if (
    (typeof guide.GuideID !== "number" && typeof guide.GuideID !== "string") ||
    typeof guide.StepID !== "number" ||
    typeof guide.GuideType !== "string" ||
    typeof guide.nTimming !== "number"
  ) {
    return null;
  }

  return {
    nTimming: guide.nTimming,
    GuideId: guide.GuideID,
    StepId: guide.StepID,
    GuideType: guide.GuideType,
  };
}
