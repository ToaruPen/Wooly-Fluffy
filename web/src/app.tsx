import { KioskPage } from "./kiosk-page";
import { StaffPage } from "./staff-page";

type Page = "kiosk" | "staff";

const getPage = (pathname: string): Page => (pathname.startsWith("/staff") ? "staff" : "kiosk");

export const App = () => {
  const page = getPage(window.location.pathname);
  return page === "staff" ? <StaffPage /> : <KioskPage />;
};
