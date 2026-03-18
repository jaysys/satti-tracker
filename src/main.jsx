import ReactDOM from "react-dom/client";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import App from "./App";
import "./styles.css";

window.CESIUM_BASE_URL = CESIUM_BASE_URL;

ReactDOM.createRoot(document.getElementById("root")).render(
  <App />,
);
