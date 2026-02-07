import styles from "./styles.module.css";

type Props = {
  isDev: boolean;
};

export const DevDebugLink = ({ isDev }: Props) => {
  if (!isDev) {
    return null;
  }
  return (
    <a className={styles.label} href="/debug" target="_blank" rel="noopener noreferrer">
      Open Debug
    </a>
  );
};
