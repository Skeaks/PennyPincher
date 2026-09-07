import { defineBackground } from "wxt/utils/define-background";
import { registerLifecycle } from "../lib/bootstrap";
import { registerProbe } from "../probe/background";
import { registerSync } from "../sync/background";

export default defineBackground(() => {
  registerLifecycle();
  registerProbe();
  registerSync();
});
