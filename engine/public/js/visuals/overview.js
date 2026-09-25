// Outline tiles: one per page or theme, clickable. `tiles: [{ title, text, icon, page }]`;
// `icon`: a file from the plan or "lucide:<name>".
import { assetOrIcon } from "./common.js";

export default {
  kind: "overview",
  render(v, ctx) {
    const { h, inline } = ctx;
    return h("div", { class: "v-overview" }, (v.tiles ?? []).map((tile) => {
      const content = [
        tile.icon ? h("span", { class: "v-tile-media" }, assetOrIcon(ctx, tile.icon)) : null,
        h("strong", {}, tile.title),
        tile.text ? h("span", { class: "muted", html: inline(tile.text) }) : null,
      ];
      return tile.page
        ? h("button", { type: "button", class: "v-tile", onclick: () => ctx.go(tile.page) }, content)
        : h("div", { class: "v-tile" }, content);
    }));
  },
};
