// js/main.js
import { buildGrid } from "./dom.js";
import { renderAll } from "./render.js";
import { setupInput } from "./input.js";
import { setupTouchControls } from "./touchControls.js";
import { setupGameStart } from "./gameStart.js";
import { setupVolumeControls } from "./volume.js";
import { setupMovementLoop } from "./movementLoop.js";
import { setupScorePanel } from "./scoreUi.js";
import { setupViewEvents } from "./viewEvents.js";
import { netClient } from "./netClient.js";

buildGrid();
renderAll();

setupViewEvents();
setupInput();
setupTouchControls();
setupGameStart();
setupVolumeControls();
setupMovementLoop();
setupScorePanel();

// サーバーがあれば自動接続(なければローカルで動く)
netClient.init();
