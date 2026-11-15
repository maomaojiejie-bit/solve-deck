import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  message: string;
  stack: string;
}

/**
 * 全站兜底：任何一页在渲染期抛错，以前会 React 直接卸根节点 ——
 * 用户看到的是纯白页、地址栏还在、没有任何返回入口（只能手改 URL）。
 * 这里接住错误，给出「这页出问题了 + 回首页 / 重试」和可折叠的技术细节。
 *
 * 换路由时由 App 用 `key` 重挂边界，所以一次崩溃不会卡住整站。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: '', stack: '' };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留到控制台，便于真机巡检抓取；不在 UI 里堆栈刷屏。
    console.error('[拆解台] 页面渲染出错：', error, info.componentStack);
    this.setState({ stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` });
  }

  render() {
    const { children } = this.props;
    const { message, stack } = this.state;
    if (!message) return children;
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col justify-center gap-4 px-6">
        <p className="id-mono text-[11px] text-faint">RENDER ERROR</p>
        <h1 className="text-[22px] font-medium leading-tight text-ink">这页出问题了，不是你的操作错</h1>
        <p className="text-[13px] leading-6 text-muted">
          这一页渲染时抛了异常，站里其它页面不受影响。可以先回首页，或者重试一次；如果每次打开同一页都这样，把下面的信息记下来。
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="#/"
            className="rounded border border-cyan px-3 py-1.5 text-[12px] text-cyan transition-colors hover:bg-cyan/10"
          >
            回首页
          </a>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-line px-3 py-1.5 text-[12px] text-ink transition-colors hover:border-cyan/60"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => this.setState({ message: '', stack: '' })}
            className="rounded border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-cyan/60"
          >
            留在本页
          </button>
        </div>
        <details className="rounded border border-line bg-panel px-3 py-2 text-[11px] text-muted">
          <summary className="cursor-pointer select-none">技术细节</summary>
          <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-all">{message + '\n' + stack}</pre>
        </details>
      </main>
    );
  }
}
