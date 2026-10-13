import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileLock } from "./components/MobileLock";
import "./index.css";
import "./premium.css";
import "./forms.css";
import "./components/MobileLock.css";

createRoot(document.getElementById("root")!).render(<MobileLock><App /></MobileLock>);
