import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getTemplateRoute } from './core/templates/registry';
import { Home } from './pages/Home';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { CursorTrail } from './ui/CursorTrail';
import { LoadingPlate } from './ui/LoadingPlate';

const Result = lazy(() =>
  import('./pages/Result').then((module) => ({ default: module.Result })),
);
const About = lazy(() => import('./pages/About').then((module) => ({ default: module.About })));
const Wizard = lazy(() => import('./pages/Wizard').then((module) => ({ default: module.Wizard })));
const Solve = lazy(() => import('./pages/Solve').then((module) => ({ default: module.Solve })));
const Scope = lazy(() => import('./pages/Scope').then((module) => ({ default: module.Scope })));
const Lab = lazy(() => import('./pages/Lab').then((module) => ({ default: module.Lab })));
const DigitalLab = lazy(() =>
  import('./pages/DigitalLab').then((module) => ({ default: module.DigitalLab })),
);
const KbIndex = lazy(() => import('./pages/KbIndex').then((module) => ({ default: module.KbIndex })));
const KbEntry = lazy(() => import('./pages/KbEntry').then((module) => ({ default: module.KbEntry })));
const Mine = lazy(() => import('./pages/Mine').then((module) => ({ default: module.Mine })));

type Route =
  | { page: 'home' }
  | { page: 'about' }
  | { page: 'wizard' }
  | { page: 'solve' }
  | { page: 'scope' }
  | { page: 'mine' }
  | { page: 'lab'; templateId?: string }
  | { page: 'digital' }
  | { page: 'kb' }
  | { page: 'kbEntry'; entryId: string }
  | { page: 'result'; templateId: string; search: string };

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [hash, search = ''] = raw.split('?');
  if (hash === 'about') return { page: 'about' };
  if (hash === 'wizard') return { page: 'wizard' };
  if (hash === 'solve') return { page: 'solve' };
  if (hash === 'scope') return { page: 'scope' };
  if (hash === 'mine') return { page: 'mine' };
  if (hash === 'lab') return { page: 'lab' };
  if (hash === 'lab/digital') return { page: 'digital' };
  if (hash === 'kb') return { page: 'kb' };
  if (hash.startsWith('kb/')) {
    const entryId = decodeURIComponent(hash.slice(3));
    return { page: 'kbEntry', entryId };
  }
  if (hash.startsWith('lab/t/')) {
    const templateId = decodeURIComponent(hash.slice(6));
    return { page: 'lab', templateId };
  }
  if (hash.startsWith('t/')) {
    const templateId = decodeURIComponent(hash.slice(2));
    if (getTemplateRoute(templateId)) return { page: 'result', templateId, search };
  }
  return { page: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseRoute());
      setToast(null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title =
      route.page === 'home'
        ? '拆解台 · SolveDeck'
        : route.page === 'about'
          ? '关于 · 拆解台'
          : route.page === 'wizard'
            ? '选型向导 · 拆解台'
            : route.page === 'solve'
              ? '我有道题 · 拆解台'
              : route.page === 'scope'
                ? '范围判别 · 拆解台'
                : route.page === 'mine'
                  ? '我的 · 拆解台'
                : route.page === 'lab'
                  ? '装配台 · 拆解台'
              : route.page === 'digital'
                ? '数字求值 · 拆解台'
                : route.page === 'kb'
                  ? '知识库 · 拆解台'
                  : route.page === 'kbEntry'
                    ? '知识条目 · 拆解台'
                    : `拆解台 · ${route.templateId}`;
  }, [route]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((message: string) => {
    setToast({ key: Date.now(), message });
  }, []);

  const backHome = useCallback(() => {
    window.location.hash = '#/';
  }, []);

  /**
   * 站内跳转：`#/solve` 用 pushState 跳（W6 §1 的约定），但 pushState 不触发 hashchange，
   * 所以这里手动同步一次路由状态，否则页面不会切。
   */
  const navigate = useCallback((hash: string) => {
    window.history.pushState(null, '', hash);
    setRoute(parseRoute());
    setToast(null);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <>
      {/* 鼠标拖尾：全站一层，纯 canvas、不进 React 状态（见 CursorTrail.tsx 注释）。 */}
      <CursorTrail />
      {route.page === 'home' ? (
        <Home />
      ) : (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center">
              <LoadingPlate title="加载只读预览" detail="正在取这一页的分包…" />
            </div>
          }
        >
          {/* 换路由重挂边界：一页崩了不拖累整站，也不会一直停在错误页。 */}
          <ErrorBoundary key={`${route.page}:${'templateId' in route ? route.templateId : ''}`}>
          {route.page === 'about' ? (
            <About onBack={backHome} />
          ) : route.page === 'wizard' ? (
            <Wizard onBack={backHome} />
          ) : route.page === 'solve' ? (
            <Solve onBack={backHome} onStart={navigate} onToast={showToast} />
          ) : route.page === 'scope' ? (
            <Scope onBack={backHome} />
          ) : route.page === 'mine' ? (
            <Mine onBack={backHome} onStart={navigate} onToast={showToast} />
          ) : route.page === 'lab' ? (
            <Lab
              templateId={route.templateId}
              /* 题型页的「← 返回」回装配台列表，不是回首页 —— 首页要再点一次才到
                 「装配台」，层级对不上（2026-11-14 巡检 D8）。 */
              onBack={route.templateId ? () => navigate('#/lab') : backHome}
              onStart={navigate}
              onToast={showToast}
            />
          ) : route.page === 'kb' ? (
            <KbIndex />
          ) : route.page === 'kbEntry' ? (
            <KbEntry id={route.entryId} />
          ) : route.page === 'digital' ? (
            <DigitalLab onBack={backHome} />
          ) : (
            <Result
              templateId={route.templateId}
              search={route.search}
              onBack={backHome}
              onToast={showToast}
            />
          )}
          </ErrorBoundary>
        </Suspense>
      )}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <div
            key={toast.key}
            role="status"
            className="anim-rise pointer-events-auto max-w-lg rounded-lg border border-amber/40 bg-panel px-4 py-2 text-xs text-amber shadow-lg"
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </>
  );
}