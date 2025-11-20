import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import { lazy, Suspense, useEffect, useState, Fragment } from "react";
const RepoDetail = lazy(() => import("./pages/RepoDetail"));
import NotFound from "./pages/NotFound";

const App = () => {
  const [TooltipProviderComp, setTooltipProviderComp] = useState<React.ComponentType<any> | null>(null);
  const [ToasterComp, setToasterComp] = useState<React.ComponentType<any> | null>(null);
  const [SonnerComp, setSonnerComp] = useState<React.ComponentType<any> | null>(null);
  // Prefetch lazy route chunk on idle to improve next navigation
  useEffect(() => {
    const prefetch = () => {
      import("./pages/RepoDetail").catch(() => {});
      // Defer non-critical UI providers to after first paint
      import("@/components/ui/tooltip").then((m) => setTooltipProviderComp(() => m.TooltipProvider)).catch(() => {});
      import("@/components/ui/toaster").then((m) => setToasterComp(() => m.Toaster)).catch(() => {});
      import("@/components/ui/sonner").then((m) => setSonnerComp(() => m.Toaster)).catch(() => {});
    };
    // Try to be polite with main thread
    // @ts-ignore
    if (typeof window !== "undefined" && window.requestIdleCallback) {
      // @ts-ignore
      const id = window.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => {
        // @ts-ignore
        if (window.cancelIdleCallback) window.cancelIdleCallback(id);
      };
    } else {
      const t = setTimeout(prefetch, 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const Provider: React.ComponentType<any> = TooltipProviderComp || Fragment;
  return (
    <Provider>
      {ToasterComp ? <ToasterComp /> : null}
      {SonnerComp ? <SonnerComp /> : null}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
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
      </BrowserRouter>
    </Provider>
  );
};

export default App;
