import { CoreHud } from "./app/CoreHud.js";
import { initConfig } from "./config.js";
import { registerSettings } from "./settings.js";
import { HTMLAlphaColorPickerElement } from "./AlphaColorPicker.js";
import { TargetPicker } from "./app/targetPicker.js";
import "../scss/module.scss";

export const MODULE_ID = "enhancedcombathud";

Object.defineProperty(globalThis.CONFIG, "ARGON", {
  get: () => {
    return CoreHud.ARGON;
  }
});

CoreHud.setControlHooks();

Hooks.on("init", () => {
  registerKeybindings();
  window.customElements.define(HTMLAlphaColorPickerElement.tagName, HTMLAlphaColorPickerElement);
});

Hooks.on("ready", () => {
  initConfig();
  registerSettings();
  ui.ARGON = new CoreHud();
  const mod = game.modules.get(MODULE_ID);
  mod.api ??= {};
  mod.api.lastTargetDistribution = null; // { itemUuid, map: Map<tokenId,count>, timestamp }
  // Run the stacking target-picker on demand (e.g. from the dnd5e bridge, after the cast level is
  // chosen). Resolves true/false; on success the distribution is published to lastTargetDistribution.
  mod.api.runStackingPicker = ({token, count, ranges, item}) =>
    new TargetPicker({token, targets: count, ranges: ranges ?? {normal: null, long: null}, stack: true, item}).promise;
});

export function registerKeybindings() {
    game.keybindings.register("enhancedcombathud", "toggleHud", {
        name: "enhancedcombathud.hotkey.toggle.name",
        editable: [{ key: "KeyA", modifiers: [foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT] }],
        restricted: false,
        onDown: () => {},
        onUp: () => {
            ui.ARGON.toggle();
        },
    });
}
