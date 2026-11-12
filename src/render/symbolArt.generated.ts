/**
 * 由 scripts/gen-symbol-art.mjs 从 public/symbols/{electronics,mechanics}/*.svg 生成，请勿手改。
 * 重新生成：node scripts/gen-symbol-art.mjs
 */
export interface SymbolArt {
  /** 来源文件名（追溯用）。 */
  file: string;
  /** 把 svg 坐标映射到积木表局部坐标的 transform。 */
  transform: string;
  /** svg 内层 markup（描边继承 currentColor）。 */
  inner: string;
}

export const SYMBOL_ART: Record<string, SymbolArt> = {
  "res": {
    file: "resistor",
    transform: "scale(0.88) translate(-50,-20)",
    inner: "<g><rect x=\"20\" y=\"10\" width=\"60\" height=\"20\"/></g> <path d=\"M0 20H20\"/> <path d=\"M80 20H100\"/>",
  },
  "diode": {
    file: "diode",
    transform: "scale(0.68) translate(-50,-20)",
    inner: "<path d=\"M0 20H34\"/> <path d=\"M34 8V32L58 20Z\"/> <path d=\"M58 8V32\"/> <path d=\"M58 20H100\"/>",
  },
  "zener": {
    file: "diode",
    transform: "scale(0.68) translate(-50,-20)",
    inner: "<path d=\"M0 20H34\"/> <path d=\"M34 8V32L58 20Z\"/> <path d=\"M58 8V32\"/> <path d=\"M58 20H100\"/><path d=\"M58 8 L51 2\"/><path d=\"M58 32 L65 38\"/>",
  },
  "npn": {
    file: "npn",
    transform: "scale(0.88) translate(-50,-50)",
    inner: "<circle cx=\"45\" cy=\"50\" r=\"30\"/> <path d=\"M0 50H30\"/> <path d=\"M30 34V66\"/> <path d=\"M30 44L60 26V0\"/> <path d=\"M30 56L60 74V100\"/> <path d=\"M45 64L41 56M45 64L52 59\"/>",
  },
  "pnp": {
    file: "pnp",
    transform: "scale(0.88) translate(-50,-50)",
    inner: "<circle cx=\"45\" cy=\"50\" r=\"30\"/> <path d=\"M0 50H30\"/> <path d=\"M30 34V66\"/> <path d=\"M30 44L60 26V0\"/> <path d=\"M30 56L60 74V100\"/> <path d=\"M44 33L51 36M44 33L49 28\"/>",
  },
  "nmos": {
    file: "nmos",
    transform: "scale(1) translate(-50,-50)",
    inner: "<g><path d=\"M0 50H22\"/><path d=\"M22 34V66\"/></g> <g><path d=\"M36 34V46\"/><path d=\"M36 54V66\"/></g> <path d=\"M36 40L60 22V0\"/> <path d=\"M36 60L60 78V100\"/> <path d=\"M40 50L46 46M40 50L46 54\"/><path d=\"M36 50H40\"/>",
  },
  "pmos": {
    file: "pmos",
    transform: "scale(1) translate(-50,-50)",
    inner: "<g><path d=\"M0 50H22\"/><path d=\"M22 34V66\"/></g> <g><path d=\"M36 34V46\"/><path d=\"M36 54V66\"/></g> <path d=\"M36 40L60 22V0\"/> <path d=\"M36 60L60 78V100\"/> <path d=\"M46 50L40 46M46 50L40 54\"/><path d=\"M36 50H46\"/>",
  },
  "nmos-r90": {
    file: "nmos",
    transform: "rotate(90) scale(1) translate(-50,-50)",
    inner: "<g><path d=\"M0 50H22\"/><path d=\"M22 34V66\"/></g> <g><path d=\"M36 34V46\"/><path d=\"M36 54V66\"/></g><path d=\"M36 34 V14 H60 V0\"/><path d=\"M36 60 V86 H60 V100\"/><path d=\"M36 72L40 78M36 72L32 78\"/>",
  },
  "pmos-r90": {
    file: "pmos",
    transform: "rotate(90) scale(1) translate(-50,-50)",
    inner: "<g><path d=\"M0 50H22\"/><path d=\"M22 34V66\"/></g> <g><path d=\"M36 34V46\"/><path d=\"M36 54V66\"/></g><path d=\"M36 34 V14 H60 V0\"/><path d=\"M36 60 V86 H60 V100\"/><path d=\"M36 78L40 72M36 78L32 72\"/>",
  },
  "opamp": {
    file: "opamp",
    transform: "scale(0.85,-0.85) translate(-50,-50)",
    inner: "<path d=\"M10 10V90L90 50Z\"/> <path d=\"M0 30H10\"/> <path d=\"M0 70H10\"/> <path d=\"M18 30H26M22 26V34\"/> <path d=\"M18 70H26\"/> <path d=\"M90 50H100\"/>",
  },
  "vsrc": {
    file: "voltage-source",
    transform: "rotate(90) scale(0.88) translate(-50,-20)",
    inner: "<path d=\"M0 20H36\"/> <circle cx=\"50\" cy=\"20\" r=\"14\"/> <path d=\"M64 20H100\"/>",
  },
  "ctrlsrc": {
    file: "ctrlsrc",
    transform: "scale(0.88) translate(-50,-50)",
    inner: "<g fill=\"none\" stroke-width=\"2\"> <path d=\"M50 12 L88 50 L50 88 L12 50 Z\"/> <path d=\"M50 100 L50 88\"/> <path d=\"M50 12 L50 0\"/> </g> <g fill=\"none\" stroke-width=\"2\"> <path d=\"M40 62 L60 38\"/> <path d=\"M50 40 L60 38 L58 48\"/> </g>",
  },
  "gnd": {
    file: "ground",
    transform: "scale(0.45) translate(-30,0)",
    inner: "<path d=\"M30 0V40\"/> <g><path d=\"M12 40H48\"/><path d=\"M18 50H42\"/><path d=\"M24 60H36\"/></g>",
  },
  "cap": {
    file: "capacitor",
    transform: "scale(0.88) translate(-50,-20)",
    inner: "<path d=\"M0 20H46\"/> <path d=\"M46 8V32\"/> <path d=\"M54 8V32\"/> <path d=\"M54 20H100\"/>",
  },
  "fixedSupport": {
    file: "fixed-support",
    transform: "scale(0.5) translate(-30,-50)",
    inner: "<path d=\"M30 0V100\"/> <path d=\"M0 50H30\"/> <g><path d=\"M30 8L14 20\"/><path d=\"M30 28L14 40\"/><path d=\"M30 48L14 60\"/><path d=\"M30 68L14 80\"/><path d=\"M30 88L18 100\"/></g>",
  },
  "pinSupport": {
    file: "pin-support",
    transform: "scale(0.5) translate(-50,0)",
    inner: "<path d=\"M50 0L24 38H76Z\"/> <path d=\"M14 38H86\"/> <g><path d=\"M18 44L10 54\"/><path d=\"M30 44L22 54\"/><path d=\"M42 44L34 54\"/><path d=\"M54 44L46 54\"/><path d=\"M66 44L58 54\"/><path d=\"M78 44L70 54\"/><path d=\"M90 44L82 54\"/></g>",
  },
  "rollerSupport": {
    file: "roller-support",
    transform: "scale(0.5) translate(-50,0)",
    inner: "<path d=\"M50 0L26 34H74Z\"/> <g><circle cx=\"36\" cy=\"41\" r=\"5\"/><circle cx=\"64\" cy=\"41\" r=\"5\"/></g> <path d=\"M12 50H88\"/>",
  },
};
