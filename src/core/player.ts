/** Step Player 的纯状态函数；不碰 DOM，不碰动画曲线。 */

export const BASE_STEP_MS = 2600;
export const SPEEDS = [0.5, 1, 2] as const;

export type PlayerSpeed = (typeof SPEEDS)[number];

export function clampStep(stepIndex: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(stepIndex, 0), stepCount - 1);
}

export function nextStep(current: number, stepCount: number): number {
  return clampStep(current + 1, stepCount);
}

export function prevStep(current: number, stepCount: number): number {
  return clampStep(current - 1, stepCount);
}

export function stepDurationMs(speed: PlayerSpeed): number {
  return BASE_STEP_MS / speed;
}

export function stepProgress(stepIndex: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return (clampStep(stepIndex, stepCount) + 1) / stepCount;
}

export function nextSpeed(speed: PlayerSpeed): PlayerSpeed {
  const index = SPEEDS.indexOf(speed);
  return SPEEDS[(index + 1) % SPEEDS.length];
}