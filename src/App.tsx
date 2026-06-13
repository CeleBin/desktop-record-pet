import { MainPanel } from "./components/panel/MainPanel";
import { PetShell } from "./components/pet/PetShell";
import { QuickInput } from "./components/capture/QuickInput";
import { ScreenshotOverlay } from "./components/capture/ScreenshotOverlay";
import { SupplementBox } from "./components/capture/SupplementBox";
import { TodoOverlay } from "./components/todo/TodoOverlay";

function App() {
  const windowLabel =
    new URLSearchParams(window.location.search).get("window") ?? "main-panel";

  if (windowLabel === "pet") {
    return <PetShell />;
  }

  if (windowLabel === "quick-input") {
    return <QuickInput />;
  }

  if (windowLabel === "supplement-box") {
    return <SupplementBox />;
  }

  if (windowLabel === "screenshot-overlay") {
    return <ScreenshotOverlay />;
  }

  if (windowLabel === "todo-overlay") {
    return <TodoOverlay />;
  }

  return <MainPanel />;
}

export default App;
