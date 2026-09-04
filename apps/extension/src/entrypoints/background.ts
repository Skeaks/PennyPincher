import { defineBackground } from "wxt/utils/define-background";
import { registerLifecycle } from "../lib/bootstrap";
import { registerProbe } from "../probe/background";

export default defineBackground(() => {
  registerLifecycle();
  registerProbe();
});
