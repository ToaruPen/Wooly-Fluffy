import { useEffect, useState } from "react";
import { connectSse } from "./sse-client";
import styles from "./styles.module.css";

type Page = "kiosk" | "staff";

const getPage = (pathname: string): Page =>
  pathname.startsWith("/staff") ? "staff" : "kiosk";

export const App = () => {
  const page = getPage(window.location.pathname);
  const streamPath = page === "staff" ? "/api/v1/staff/stream" : "/api/v1/kiosk/stream";
  const title = page === "staff" ? "STAFF" : "KIOSK";
  const [snapshot, setSnapshot] = useState<unknown | null>(null);

  useEffect(() => {
    const client = connectSse(streamPath, { onSnapshot: setSnapshot });
    return () => {
      client.close();
    };
  }, [streamPath]);

  const snapshotText = snapshot ? JSON.stringify(snapshot, null, 2) : "Waiting for snapshot...";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <div className={styles.label}>Stream: {streamPath}</div>
      </header>
      <main className={styles.content}>
        <h2>Latest snapshot</h2>
        <pre className={styles.snapshot}>{snapshotText}</pre>
      </main>
    </div>
  );
};
