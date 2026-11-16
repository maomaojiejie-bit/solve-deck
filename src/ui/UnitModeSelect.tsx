import { useSyncExternalStore } from 'react';
import {
  getUnitMode,
  setUnitMode,
  subscribeUnitMode,
  UNIT_MODE_LABEL,
  type UnitMode,
} from '../core/units.ts';

/**
 * R-37 单位制切换。用 useSyncExternalStore 订阅全局偏好：
 * 结果页与装配台各放一份，切任意一个，两处读数同时跟着变。
 * 只影响显示，不写回任何参数草稿 / 求解输入。
 */
export function UnitModeSelect({ testId = 'unit-mode', label = '读数单位制' }: { testId?: string; label?: string }) {
  const mode = useSyncExternalStore(subscribeUnitMode, getUnitMode, () => 'auto' as UnitMode);
  return (
    <label className="no-print inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-muted">
      <span>单位</span>
      <select
        data-testid={testId}
        aria-label={label}
        value={mode}
        onChange={(event) => setUnitMode(event.target.value as UnitMode)}
        className="rounded border border-line bg-bg px-1 py-0.5 text-[10px] text-muted outline-none focus:border-cyan/60"
        title="只改「读数字」的写法，不改图：自动 / 基本单位 SI（无前缀，适合代公式）/ 工程单位（kN、MPa、mm，适合读表）。画布标注与讲解稿按题面单位写，不跟着切。"
      >
        {(Object.keys(UNIT_MODE_LABEL) as UnitMode[]).map((key) => (
          <option key={key} value={key}>
            {UNIT_MODE_LABEL[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
