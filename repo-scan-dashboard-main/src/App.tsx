import { HashRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import { lazy, Suspense, useEffect, useState, Fragment } from "react";
const RepoDetail = lazy(() => import("./pages/repo-detail"));
const Setup = lazy(() => import("./pages/setup"));
import NotFound from "./pages/not-found";

const App = () => {
  const [TooltipProviderComp, setTooltipProviderComp] = useState<React.ComponentType<React.PropsWithChildren> | null>(null);
  const [ToasterComp, setToasterComp] = useState<React.ComponentType | null>(null);
  const [SonnerComp, setSonnerComp] = useState<React.ComponentType | null>(null);
  // Prefetch lazy route chunk on idle to improve next navigation
  useEffect(() => {
    const prefetch = () => {
      import("./pages/repo-detail").catch(() => { });
      // Defer non-critical UI providers to after first paint
      import("@/components/ui/tooltip").then((m) => setTooltipProviderComp(() => m.TooltipProvider)).catch(() => { });
      import("@/components/ui/toaster").then((m) => setToasterComp(() => m.Toaster)).catch(() => { });
      import("@/components/ui/sonner").then((m) => setSonnerComp(() => m.Toaster)).catch(() => { });
    };
    // Try to be polite with main thread
    if (typeof window !== "undefined" && window.requestIdleCallback) {
      const id = window.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => {
        if (window.cancelIdleCallback) window.cancelIdleCallback(id);
      };
    } else {
      const t = setTimeout(prefetch, 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const Provider: React.ComponentType<React.PropsWithChildren> = TooltipProviderComp || Fragment;
  return (
    <Provider>
      {ToasterComp ? <ToasterComp /> : null}
      {SonnerComp ? <SonnerComp /> : null}
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/setup"
            element={
              <Suspense fallback={<div className="p-6 text-muted-foreground">Cargando...</div>}>
                <Setup />
              </Suspense>
            }
          />
          <Route
            path="/repos/:slug"
            element={
              <Suspense fallback={<div className="p-6 text-muted-foreground">Cargando repositorio…</div>}>
                <RepoDetail />
              </Suspense>
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </Provider>
  );
};

export default App;
