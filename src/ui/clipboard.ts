/**
 * 复制文本：Clipboard API 优先，失败退到隐藏 textarea + execCommand。
 *
 * 调用方必须**按返回值说话** —— 以前装配台直接 `void navigator.clipboard.writeText(...)`
 * 并提示「已复制」，浏览器拒绝授权（非 https、无用户手势、隐私模式）时用户
 * 粘贴出来是空的，却看到成功提示。这里返回布尔值，让 UI 能如实降级。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      // 浏览器可能把 writeText 挂在一个永不 settle 的权限提示上（无头 / 弹了授权框），
      // 不能无限等：1.2s 内没结果就按失败处理，转兜底并如实提示。
      const ok = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1200)),
      ]);
      if (ok) return true;
    }
  } catch {
    /* 继续走兜底 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
