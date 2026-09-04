import { defineBackground } from "wxt/utils/define-background";
import { registerLifecycle } from "../lib/bootstrap";

export default defineBackground(() => {
  registerLifecycle();
});
