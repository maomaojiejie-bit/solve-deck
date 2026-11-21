// 场景双主题色板。画布本体已透明（页面图纸底透出，深浅主题自动跟随），
// 但 three.js 材质只吃实色 hex、CSS 变量进不了 WebGL，故在场景层镜像一份
// tokens.css 的深浅两档值，并用 MutationObserver 订阅 <html data-theme> 翻转。
// Html 标签是 DOM 叠加层，直接用 CSS 变量（见 tagStyle），零订阅自动换色。
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export interface ScenePalette {
  gridMajor: string;
  gridMinor: string;
  ink: string;
  muted: string;
  faint: string;
  tension: string;
  compression: string;
  zero: string;
  amber: string;
  gold: string;
  ok: string;
  danger: string;
  purple: string;
  support: string;
  supportBase: string;
  axis: [string, string, string];
}

const LIGHT: ScenePalette = {
  gridMajor: "#a29b8c",
  gridMinor: "#dcd5c6",
  ink: "#16140f",
  muted: "#5c574c",
  faint: "#857f72",
  tension: "#a32a1c",
  compression: "#1b3f9c",
  zero: "#a29b8c",
  amber: "#a15c14",
  gold: "#b0761f",
  ok: "#1f6a4a",
  danger: "#a32a1c",
  purple: "#16706b",
  support: "#a29b8c",
  supportBase: "#857f72",
  axis: ["#a32a1c", "#1f6a4a", "#1b3f9c"],
};

const DARK: ScenePalette = {
  gridMajor: "#57503f",
  gridMinor: "#2a261d",
  ink: "#f4f0e6",
  muted: "#a8a190",
  faint: "#7c7566",
  tension: "#f28d7e",
  compression: "#8ab0ff",
  zero: "#6d6759",
  amber: "#e0b072",
  gold: "#c99450",
  ok: "#7ac9a0",
  danger: "#f28d7e",
  purple: "#62b3ab",
  support: "#6d6759",
  supportBase: "#7c7566",
  axis: ["#f28d7e", "#7ac9a0", "#8ab0ff"],
};

/** 订阅 <html data-theme>（ThemeToggle 是唯一写入口），返回当前是否深色 */
export function useSceneDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.dataset.theme === "dark");
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function useScenePalette(): ScenePalette {
  return useSceneDark() ? DARK : LIGHT;
}

/** 画布 Html 标签统一样式：等宽字体（与项目数字/编号口径一致）+ token 色 + 自适应光晕。
 *  color 传 CSS 变量（如 var(--color-muted)）即随主题自动切换，无需重渲染。
 *  标签走屏幕空间（不加 distanceFactor）：字号恒为 10px 不随镜头缩放，
 *  与页面正文的 mono 口径一致；否则拉近镜头时标签会被放大成一大片「块」。 */
export function tagStyle(color: string, extra?: CSSProperties): CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
    fontWeight: 400,
    lineHeight: 1.25,
    letterSpacing: "0.01em",
    color,
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    textShadow: "var(--scene-halo)",
    ...extra,
  };
}
