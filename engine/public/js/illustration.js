// The illustration of a visual that carries a `prompt`: the selected image (and its other versions),
// or a slot with the “Illustrate” button. Generating goes through a dialog that states the cost:
// each generation uses credits, 5 at most per service and per plan.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { badge, button, dialog, selectBox, toast } from "./ui.js";

const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16"];

export function illustrationFor(target, visual, ctx) {
  if (!visual?.prompt) return null;
  const { t } = ctx;
  const el = h("div", { class: "illustration" });

  const canGenerate = () => !ctx.readOnly() && ctx.images.providers.some((p) => p.configured && p.ready && p.remaining > 0);

  function render() {
    const state = ctx.images;
    const versions = state.items.filter((item) => item.target === target);
    const chosen = versions.find((item) => item.id === state.selected[target]) ?? versions.at(-1);
    const generate = button({ label: chosen ? t("images.again") : t("images.generate"), icon: "sparkles", variant: chosen ? "outline" : "default", size: "sm", onclick: () => openDialog() });
    generate.hidden = !canGenerate();
    if (chosen) {
      const provider = state.providers.find((p) => p.id === chosen.provider);
      el.replaceChildren(h("figure", { class: "illustration-figure" },
        h("img", { src: ctx.asset(chosen.file), alt: visual.alt ?? chosen.prompt.slice(0, 140), loading: "lazy" }),
        h("figcaption", {},
          badge(t("images.generated"), { variant: "secondary", icon: "sparkles" }),
          h("span", { class: "muted" }, `${provider?.label ?? chosen.provider}${chosen.model ? ` · ${chosen.model}` : ""}`),
          versions.length > 1 ? h("span", { class: "illustration-versions", role: "group", "aria-label": t("images.versions") }, versions.map((item, i) =>
            h("button", {
              type: "button",
              class: "illustration-thumb",
              "aria-pressed": String(item.id === chosen.id),
              title: t("images.version", { n: i + 1 }),
              onclick: () => choose(item.id),
            }, h("img", { src: ctx.asset(item.file), alt: "" })))) : null,
          generate)));
      return;
    }
    const reason = ctx.readOnly() ? t("images.locked") : noProviderReason(state, t);
    el.replaceChildren(h("div", { class: "illustration-empty" },
      icon("image", { className: "icon-lg" }),
      h("div", { class: "illustration-text" },
        h("div", { class: "illustration-title" }, t("images.placeholder")),
        h("p", { class: "muted illustration-prompt" }, visual.prompt),
        reason ? h("p", { class: "muted illustration-reason" }, reason) : null),
      generate));
  }

  async function choose(image) {
    try {
      ctx.setImages(await ctx.api.selectImage({ target, image }));
    } catch (error) {
      toast(error.message, { variant: "error" });
    }
  }

  function openDialog() {
    const state = ctx.images;
    const usable = state.providers.filter((p) => p.configured && p.ready && p.remaining > 0);
    let provider = usable[0]?.id;
    const name = `provider-${target}`;
    const options = state.providers.map((p) => {
      const disabled = !p.configured || !p.ready || p.remaining <= 0;
      const input = h("input", { type: "radio", name, value: p.id, checked: p.id === provider, disabled, onchange: () => { provider = p.id; } });
      const note = !p.configured ? t("images.noKey") : !p.ready ? t("images.notReady") : p.remaining <= 0 ? t("images.exhausted", { quota: state.quota }) : t("images.remaining", { count: p.remaining, quota: state.quota });
      return h("label", { class: `radio-card provider-option${disabled ? " disabled" : ""}` }, input,
        h("span", { class: "rc-title" }, p.label),
        h("div", { class: "rc-body" }, h("span", {}, p.model), badge(note, { variant: disabled ? "outline" : "secondary" })));
    });
    const prompt = h("textarea", { class: "textarea", rows: 4, "aria-label": t("images.prompt") });
    prompt.value = visual.prompt;
    const aspect = selectBox({ options: ASPECTS.map((a) => ({ value: a, label: t(`images.aspect.${a}`) })), value: ASPECTS.includes(visual.aspect) ? visual.aspect : "16:9", ariaLabel: t("images.aspect") });
    const transparent = h("input", { type: "checkbox", checked: Boolean(visual.transparent) });
    const progress = h("p", { class: "muted images-progress", hidden: true }, icon("loader-circle", { className: "spin" }), t("images.working"));
    dialog({
      title: t("images.dialogTitle"),
      description: t("images.dialogText", { quota: state.quota }),
      closeLabel: t("common.close"),
      content: h("div", { class: "images-form" },
        h("div", { class: "field" }, h("span", { class: "label" }, t("images.provider")), h("div", { class: "provider-list", role: "radiogroup" }, options)),
        h("div", { class: "field" }, h("span", { class: "label" }, t("images.prompt")), prompt),
        h("div", { class: "images-row" },
          h("div", { class: "field" }, h("span", { class: "label" }, t("images.aspect")), aspect.el),
          h("label", { class: "images-check" }, transparent, t("images.transparent"))),
        progress),
      actions: ({ close }) => [
        button({ label: t("common.cancel"), variant: "outline", onclick: close }),
        button({
          label: t("images.confirm"),
          icon: "sparkles",
          disabled: !provider,
          onclick: async (event) => {
            const confirm = event.currentTarget;
            confirm.disabled = true;
            progress.hidden = false;
            try {
              const result = await ctx.api.generateImage({ provider, target, prompt: prompt.value, aspect: aspect.select.value, transparent: transparent.checked });
              ctx.setImages(result.state);
              close();
              toast(t("images.done", { path: result.path }), { variant: "success" });
            } catch (error) {
              progress.hidden = true;
              confirm.disabled = false;
              toast(error.message, { variant: "error", duration: 8000 });
              try {
                ctx.setImages(await ctx.api.refreshImages());
              } catch {
                /* the counter will catch up on the next load */
              }
            }
          },
        }),
      ],
    });
  }

  render();
  ctx.onImages(render, el);
  return { el, update: render };
}

function noProviderReason(state, t) {
  const configured = state.providers.filter((p) => p.configured);
  if (!configured.length) return t("images.noProvider");
  if (configured.every((p) => p.remaining <= 0)) return t("images.allExhausted", { quota: state.quota });
  return "";
}
