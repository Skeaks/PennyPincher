import { defineBackground } from "wxt/utils/define-background";
import { registerHealthBeacon } from "../capture/health";
import { registerLifecycle } from "../lib/bootstrap";
import { registerProbe } from "../probe/background";
import { registerSync } from "../sync/background";

export default defineBackground(() => {
  registerLifecycle();
  registerProbe();
  registerSync();
  registerHealthBeacon();
});
