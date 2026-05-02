import { createRoot, type Root } from "react-dom/client";
import { LessonPlayer } from "./components/LessonPlayer";

const DEFAULT_VIDEO_ID = "_QNJVYEjSZ0";

let root: Root | null = null;

function mountLessonPlayer(container: HTMLElement, userId: string) {
  if (root) {
    root.unmount();
    root = null;
  }
  root = createRoot(container);
  root.render(
    <LessonPlayer videoId={DEFAULT_VIDEO_ID} userId={userId} />
  );
}

function unmountLessonPlayer() {
  if (root) {
    root.unmount();
    root = null;
  }
}

declare global {
  interface Window {
    mountLessonPlayer?: (container: HTMLElement, userId: string) => void;
    unmountLessonPlayer?: () => void;
  }
}

window.mountLessonPlayer = mountLessonPlayer;
window.unmountLessonPlayer = unmountLessonPlayer;
