// A sheet of captioned icons: `icons: [{ icon, label }]`.
import { assetOrIcon } from "./common.js";

export default {
  kind: "icons",
  render(v, ctx) {
    const { h } = ctx;
    return h("div", { class: "v-icons" }, (v.icons ?? []).map((entry) =>
      h("figure", {}, assetOrIcon(ctx, entry.icon), h("figcaption", {}, entry.label))));
  },
};
