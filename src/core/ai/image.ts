/**
 * 图片这一层里「不需要浏览器」的那一半（W7 §A）。
 *
 * 分成两半是刻意的：
 *  - 这里只放**能算出来的**东西（张数上限、缩放与质量怎么取、直方图拉伸的像素变换）；
 *  - canvas / FileReader 那些只能在浏览器里跑的，放 `src/ui/imagePipeline.ts`。
 * 这样 `check:ai` 才能在 node 里验「第 4 张被拒」「拉伸把灰底拉白」这类规矩，
 * 不用起浏览器、也不用把 canvas 塞进门禁。
 *
 * 红线（三处都写着，怕忘）：图片只进「显示」和「发给用户自己配的服务商」两条路，
 * 不写文件、不进 localStorage、不进 URL、不进快照。
 */

/** 一次最多 3 张（第 4 张明确提示，不静默丢弃）。 */
export const MAX_IMAGES = 3;

/** 送模型的长边上限：1600px 足够看清支座与标注，再大只是白烧 token。 */
export const MAX_EDGE = 1600;
/** 压缩后仍超过这个字节数就让人裁图（4MB 是多数兼容端点的单图上限）。 */
export const MAX_BYTES = 4 * 1024 * 1024;
export const QUALITY_NORMAL = 0.85;
export const QUALITY_SMALL = 0.7;

export const IMAGE_REJECTED = '最多 3 张';

export interface ProblemImage {
  /** 稳定 id：只用于 React key 与「删掉」。 */
  id: string;
  /** 展示用原图（不做任何处理，用户要看到自己拍的那张）。 */
  src: string;
  /** 送模型的那份（缩放 + 压 jpeg + 直方图拉伸后的 dataURL）。 */
  send: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * 加一张图：超过 3 张就拒，返回原列表 + 一句提示（不抛错，页面只需 toast）。
 * 纯函数、不改入参 —— 门禁直接拿它验「第 4 张被拒」。
 */
export function addImage(
  list: readonly ProblemImage[],
  image: ProblemImage,
): { list: ProblemImage[]; error?: string } {
  if (list.length >= MAX_IMAGES) return { list: [...list], error: IMAGE_REJECTED };
  return { list: [...list, image] };
}

export function removeImage(list: readonly ProblemImage[], id: string): ProblemImage[] {
  return list.filter((image) => image.id !== id);
}

export interface PreprocessPlan {
  width: number;
  height: number;
  quality: number;
  /** 缩了几倍（1 = 原尺寸）。 */
  scale: number;
  /** 原图尺寸是否被缩过（纯提示用）。 */
  resized: boolean;
}

/** 缩放与压缩策略：长边 > 1600 等比缩；原图 > 4MB 就把质量从 0.85 降到 0.7。 */
export function planPreprocess(width: number, height: number, bytes: number): PreprocessPlan {
  const edge = Math.max(width, height);
  const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: bytes > MAX_BYTES ? QUALITY_SMALL : QUALITY_NORMAL,
    scale,
    resized: scale < 1,
  };
}

/**
 * 直方图拉伸：取亮度 2% / 98% 分位当黑点白点，把发灰的作业照拉回来。
 * 原地改 RGB，alpha 不动（透明像素不是题目信息，别动它）。
 * 返回 { lo, hi } 方便门禁断言「确实动了」，也方便调试。
 */
export function stretchHistogram(data: Uint8ClampedArray): { lo: number; hi: number } {
  const histogram = new Uint32Array(256);
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return { lo: 0, hi: 255 };
  for (let index = 0; index < data.length; index += 4) {
    // 亮度按人眼权重，别用 (r+g+b)/3：白纸上的蓝色圆珠笔会算得过暗
    const luma = Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
    histogram[Math.min(255, Math.max(0, luma))] += 1;
  }
  const pick = (ratio: number) => {
    const target = pixels * ratio;
    let seen = 0;
    for (let level = 0; level < 256; level += 1) {
      seen += histogram[level];
      if (seen >= target) return level;
    }
    return 255;
  };
  const lo = pick(0.02);
  const hi = pick(0.98);
  if (hi - lo < 8) return { lo, hi }; // 已经是纯黑/纯白，再拉只会拉出噪点

  const span = hi - lo;
  const table = new Uint8ClampedArray(256);
  for (let level = 0; level < 256; level += 1) {
    table[level] = Math.min(255, Math.max(0, Math.round(((level - lo) * 255) / span)));
  }
  for (let index = 0; index < data.length; index += 4) {
    data[index] = table[data[index]];
    data[index + 1] = table[data[index + 1]];
    data[index + 2] = table[data[index + 2]];
  }
  return { lo, hi };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 页面与门禁共用的一句：图片永远只是参照物。 */
export const IMAGE_CAPTION = '仅作参照，不参与计算';
