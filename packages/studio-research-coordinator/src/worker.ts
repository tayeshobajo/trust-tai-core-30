import { runWorker } from "@paperclipai/plugin-sdk";
import { makePreviewWorker } from "./preview-bootstrap";
const plugin = makePreviewWorker();
export default plugin;
runWorker(plugin, import.meta.url);
