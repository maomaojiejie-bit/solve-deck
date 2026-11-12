import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getTemplateRoute } from './core/templates/registry';
import { Home } from './pages/Home';

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

type Route =
  | { page: 'home' }
  | { page: 'about' }
  | { page: 'wizard' }
  | { page: 'solve' }
  | { page: 'scope' }
  | { page: 'lab'; templateId?: string }
  | { page: 'digital' }
  | { page: 'result'; templateId: string; search: string };

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [hash, search = ''] = raw.split('?');
  if (hash === 'about') return { page: 'about' };
  if (hash === 'wizard') return { page: 'wizard' };
  if (hash === 'solve') return { page: 'solve' };
  if (hash === 'scope') return { page: 'scope' };
  if (hash === 'lab') return { page: 'lab' };
  if (hash === 'lab/digital') return { page: 'digital' };
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
                : route.page === 'lab'
                  ? '装配台 · 拆解台'
                  : route.page === 'digital'
                    ? '数字求值 · 拆解台'
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

  const openTemplate = useCallback((templateId: string) => {
    window.location.hash = `#/t/${templateId}`;
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
      {route.page === 'home' ? (
        <Home onOpen={openTemplate} onToast={showToast} />
      ) : (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-muted">
              加载只读预览…
            </div>
          }
        >
          {route.page === 'about' ? (
            <About onBack={backHome} />
          ) : route.page === 'wizard' ? (
            <Wizard onBack={backHome} />
          ) : route.page === 'solve' ? (
            <Solve onBack={backHome} onStart={navigate} onToast={showToast} />
          ) : route.page === 'scope' ? (
            <Scope onBack={backHome} />
          ) : route.page === 'lab' ? (
            <Lab templateId={route.templateId} onBack={backHome} onStart={navigate} onToast={showToast} />
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