/**
 * 图片预处理（W7 §A 的 §D）：**只处理要送给模型的那一份**。
 *
 * 展示用的原图原样保留 —— 用户要看到自己拍的那张，压缩过的图会让人以为「拍糊了」。
 * 所以一张图在页面里是两串 dataURL：`src`（原图，显示）与 `send`（预处理后，送模型）。
 *
 * 这里只能用浏览器 API（createImageBitmap / canvas / toBlob），所以放在 ui 层：
 * 纯计算的部分（缩放策略、直方图拉伸、3 张上限）在 `src/core/ai/image.ts`，
 * 门禁在 node 里验那一半，这一半靠截图与人工看图验。
 */

import {
  MAX_BYTES,
  addImage,
  formatBytes,
  planPreprocess,
  stretchHistogram,
  type ProblemImage,
} from '../core/ai/image';

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('读不了这个文件'));
    reader.readAsDataURL(blob);
  });
}

async function decode(source: Blob): Promise<{ width: number; height: number; draw: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    return { width: bitmap.width, height: bitmap.height, draw: bitmap };
  }
  const url = URL.createObjectURL(source);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('这个文件不是图片'));
      image.src = url;
    });
    return { width: element.naturalWidth, height: element.naturalHeight, draw: element };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 一张 `File` → 页面里的一张「题目原图」。
 * 失败一律抛带人话的 Error（页面转成 toast），不返回半成品。
 */
export async function prepareImage(file: File, id: string): Promise<ProblemImage> {
  if (!file.type.startsWith('image/')) throw new Error('只能贴图片（截图 / 拍照都行）');
  const src = await readAsDataUrl(file);
  const decoded = await decode(file);
  const plan = planPreprocess(decoded.width, decoded.height, file.size);

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器不支持 canvas，没法预处理图片');
  context.drawImage(decoded.draw, 0, 0, plan.width, plan.height);

  // 直方图拉伸：发灰的作业照能救回来一档；出错（跨域/显存）就跳过，不值得为它失败
  try {
    const pixels = context.getImageData(0, 0, plan.width, plan.height);
    stretchHistogram(pixels.data);
    context.putImageData(pixels, 0, 0);
  } catch {
    // 拿不到像素（极端情况）就当作不需要拉伸
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', plan.quality));
  if (!blob) throw new Error('图片压缩失败，换一张试试');
  if (blob.size > MAX_BYTES) {
    throw new Error(`压完还有 ${formatBytes(blob.size)}，图片太大，请裁一下题目区域再贴`);
  }
  const send = await readAsDataUrl(blob);

  if (typeof decoded.draw === 'object' && 'close' in decoded.draw) {
    (decoded.draw as ImageBitmap).close();
  }

  return { id, src, send, bytes: blob.size, width: plan.width, height: plan.height };
}

/** 一次收多个文件：超过 3 张就停在 3 张，并把提示原样带回去。 */
export async function prepareImages(
  files: readonly File[],
  existing: readonly ProblemImage[],
): Promise<{ list: ProblemImage[]; errors: string[] }> {
  let list = [...existing];
  const errors: string[] = [];
  let index = 0;
  for (const file of files) {
    const { list: next, error } = addImage(list, {
      // 先占位，成功后再换成真数据；addImage 只看张数
      id: `img-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      src: '',
      send: '',
      bytes: 0,
      width: 0,
      height: 0,
    });
    if (error) {
      errors.push(error);
      break;
    }
    index += 1;
    try {
      const prepared = await prepareImage(file, next[next.length - 1].id);
      list = [...list, prepared];
    } catch (problem) {
      errors.push(problem instanceof Error ? problem.message : String(problem));
    }
  }
  return { list, errors };
}
