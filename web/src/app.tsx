import { lazy, Suspense } from "react";
import { KioskPage } from "./kiosk-page";
import { StaffPage } from "./staff-page";

const DebugPageLazy = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import("./debug-page");
      return { default: mod.DebugPage };
    })
  : null;

type Page = "kiosk" | "staff" | "debug";

export const getPage = (pathname: string, isDev: boolean): Page => {
  const isDebugPath = pathname === "/debug" || pathname.startsWith("/debug/");
  if (isDev && isDebugPath) {
    return "debug";
  }
  return pathname.startsWith("/staff") ? "staff" : "kiosk";
};

export const App = () => {
  const page = getPage(window.location.pathname, import.meta.env.DEV as boolean);
  if (page === "debug" && DebugPageLazy) {
    return (
      <Suspense fallback={null}>
        <DebugPageLazy />
      </Suspense>
    );
  }
  return page === "staff" ? <StaffPage /> : <KioskPage />;
};
