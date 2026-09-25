// Steps of a progression: `tiers: [{ icon, label, value }]`, `grow` for icons that get bigger.
import { assetOrIcon } from "./common.js";

export default {
  kind: "tiers",
  render(v, ctx) {
    const { h } = ctx;
    const count = (v.tiers ?? []).length;
    return h("div", { class: "v-tiers" }, (v.tiers ?? []).map((tier, i) => {
      const size = v.grow ? Math.round(32 + (i / Math.max(1, count - 1)) * 28) : 48;
      const media = assetOrIcon(ctx, tier.icon);
      if (media) media.style.setProperty("--size", `${size}px`);
      return h("div", { class: "v-tier" },
        h("div", { class: "v-tier-media" }, media),
        h("span", { class: "v-tier-label" }, tier.label),
        tier.value ? h("span", { class: "muted v-tier-value" }, tier.value) : null);
    }));
  },
};
