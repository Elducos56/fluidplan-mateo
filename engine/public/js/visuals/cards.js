// Illustrated cards: `cards: [{ title, text, icon }]`.
import { assetOrIcon } from "./common.js";

export default {
  kind: "cards",
  render(v, ctx) {
    const { h, inline } = ctx;
    return h("div", { class: "v-cards" }, (v.cards ?? []).map((card) =>
      h("div", { class: "v-card" },
        card.icon ? h("span", { class: "v-card-media" }, assetOrIcon(ctx, card.icon)) : null,
        h("div", {}, h("strong", {}, card.title), card.text ? h("p", { class: "muted", html: inline(card.text) }) : null))));
  },
};
