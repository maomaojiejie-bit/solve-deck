import { useMemo } from 'react';
import katex from 'katex';

interface FormulaProps {
  tex: string;
  block?: boolean;
  className?: string;
}

/** KaTeX 只渲染静态 JSON 里的公式；trust 保持默认 false。 */
export function Formula({ tex, block = false, className }: FormulaProps) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        throwOnError: false,
        displayMode: block,
        strict: false,
      }),
    [tex, block],
  );
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}