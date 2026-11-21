// Q4 E3 一级路由：MechModel → SolutionKin（与 solveTruss 并列的独立引擎入口）。
// 拒答口径与 E1/E2 一致：refusals 存在时 frames/series/keyValues 全空，不产数字。
import type { MechModel, SolutionKin } from "./types";
import { solveK1, solveK2, solveK3, solveK4, solveK4R, type KinResult } from "./kinematics.ts";
import { solveD1, solveD2, solveD3, solveD4, solveD5 } from "./dynamics.ts";

export function solveMech(model: MechModel): SolutionKin {
  const t0 = Date.now();
  const r = dispatch(model, t0);
  if (r.refusals) {
    return {
      modelId: model.id,
      kind: model.type.startsWith("K") ? "kin" : "dyn",
      headline: r.headline,
      verified: false,
      duration: model.duration,
      frames: [],
      series: [],
      keyValues: [],
      steps: r.steps,
      checks: [],
      warnings: [],
      refusals: r.refusals,
      solveMs: Date.now() - t0,
    };
  }
  const verified = r.checks.every((c) => c.pass);
  return {
    modelId: model.id,
    kind: model.type.startsWith("K") ? "kin" : "dyn",
    headline: r.headline,
    verified,
    duration: model.duration,
    frames: r.frames,
    series: r.series,
    keyValues: r.keyValues,
    steps: r.steps,
    checks: r.checks,
    warnings: r.warnings,
    solveMs: Date.now() - t0,
  };
}

function dispatch(model: MechModel, t0: number): KinResult {
  switch (model.type) {
    case "K1":
      return solveK1(model, t0);
    case "K2":
      return solveK2(model, t0);
    case "K3":
      return solveK3(model, t0);
    case "K4":
      return solveK4(model, t0);
    case "K4R":
      return solveK4R(model, t0);
    case "D1":
      return solveD1(model, t0);
    case "D2":
      return solveD2(model, t0);
    case "D3":
      return solveD3(model, t0);
    case "D4":
      return solveD4(model, t0);
    case "D5":
      return solveD5(model, t0);
    default:
      return {
        headline: `拒答：未知 E3 模板 ${model.type}`,
        frames: [],
        series: [],
        keyValues: [],
        checks: [],
        warnings: [],
        steps: [
          { title: "认题", detail: `模板 ${model.type} 不在 K1–K4R/D1–D5 清单内` },
          { title: "求解", detail: "拒答，不产出数字" },
        ],
        refusals: [`未知模板 ${model.type}`, "二期 E3 覆盖 K1–K4（运动学）与 D1–D5（动力学），拉格朗日 D6 留三期"],
      };
    }
}
