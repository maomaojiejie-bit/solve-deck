/** P3 范围门：只放行注册表 status === 'ready' 的题型。 */

import { getTemplate } from '../core/templates/registry.ts';

export interface ScopeGateResult {
  ok: boolean;
  detail: string;
}

export function scopeGate(templateId: string): ScopeGateResult {
  let entry;
  try {
    entry = getTemplate(templateId);
  } catch {
    return { ok: false, detail: `未注册的 templateId：${templateId}` };
  }
  if (entry.status !== 'ready') {
    return {
      ok: false,
      detail: `${templateId} 当前 status=${entry.status}，scopeGate 只放行 ready`,
    };
  }
  return { ok: true, detail: `${templateId} ready，放行` };
}