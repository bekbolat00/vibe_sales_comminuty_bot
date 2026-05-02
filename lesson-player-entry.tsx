import { createRoot, type Root } from "react-dom/client";
import { LessonPlayer } from "./components/LessonPlayer";

let root: Root | null = null;

function mountLessonPlayer(
  container: HTMLElement,
  userId: string,
  videoId: string
) {
  if (root) {
    root.unmount();
    root = null;
  }
  root = createRoot(container);
  root.render(<LessonPlayer videoId={videoId} userId={userId} />);
}

function unmountLessonPlayer() {
  if (root) {
    root.unmount();
    root = null;
  }
}

declare global {
  interface Window {
    mountLessonPlayer?: (
      container: HTMLElement,
      userId: string,
      videoId: string
    ) => void;
    unmountLessonPlayer?: () => void;
  }
}

window.mountLessonPlayer = mountLessonPlayer;
window.unmountLessonPlayer = unmountLessonPlayer;
