/**
 * 画布两次点击的会话状态机（页面与门禁共用）。
 *
 * 门禁里「依次派发 pointerdown 到 n-vs:p、n-rl:b」走的就是这个 reducer：
 * 它决定选中第一个点、拉橡皮筋、第二次点击提交 addEdge / addMember，
 * 或给出拒绝理由。页面只在 reducer 返回 op 时才 mutate 图 —— 拒绝不动 dirty。
 */

import type { CanvasGraph } from './types.ts';
import { TEXT_HINT, bodyHint, validateConnection, type WireVerdict } from './wiring.ts';

export type PointerHit =
  | { kind: 'pin'; key: string }
  | { kind: 'node'; key: string }
  | { kind: 'body'; nodeKind?: string }
  | { kind: 'label' }
  | { kind: 'blank' };

export interface PointerSession {
  /** 第一个被点中的锚点 key（橡皮筋起点）。 */
  first: string | null;
  /** 「请点引脚」已经提示过，避免每次都弹。 */
  hinted?: boolean;
}

export interface ClickOutcome {
  session: PointerSession;
  /** 非 undefined 时页面据此 mutate（ok=false 只 toast）。 */
  verdict?: WireVerdict;
  note?: string;
  /** 点空白 → 明确取消本次连线。 */
  cancelled?: boolean;
}

export const emptySession = (): PointerSession => ({ first: null, hinted: false });

export function wireClick(graph: CanvasGraph, session: PointerSession, hit: PointerHit): ClickOutcome {
  const first = session.first;
  if (hit.kind === 'blank') {
    // 唯一的静默分支：取消连线，但一个字都不弹（W12「不许静默」的例外）。
    return first ? { session: emptySession(), cancelled: true } : { session };
  }
  if (hit.kind === 'label') {
    return { session, note: TEXT_HINT };
  }
  if (hit.kind === 'body') {
    // 电路器件本体不是接线端点；力学不会走到这里（力学点节点）。
    if (session.hinted) return { session };
    return { session: { ...session, hinted: true }, note: bodyHint(hit.nodeKind) };
  }
  if (!first) {
    return { session: { ...session, first: hit.key } };
  }
  const verdict = validateConnection(graph, first, hit.key);
  return {
    session: emptySession(),
    verdict,
    ...(verdict.ok ? {} : { note: verdict.reason }),
  };
}

/** 拖动 / 双击 / Esc 不改变连线会话，页面各自处理。 */
export function cancelWire(session: PointerSession): PointerSession {
  return { ...emptySession(), hinted: session.hinted };
}
