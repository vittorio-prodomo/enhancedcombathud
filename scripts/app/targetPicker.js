import { showRangeFinder, showRangeRings, clearRangeFinders, clearRanges } from "./components/main/buttons/itemButton.js";

let activeTargetPicker = null;

export class TargetPicker{
  constructor ({token, targets, ranges, stack = false, item = null}) {
    checkShowTargetPickerGuide();
    if (activeTargetPicker) activeTargetPicker.end(false);
    activeTargetPicker = this;
    this.ranges = ranges;
    this.token = token;
    this.stack = stack;
    this.item = item;
    this.distribution = new Map(); // Token -> count (stacking mode only)
    this._controlled = canvas.tokens.controlled.map(t => t.id); // caster selection to preserve
    this._pending = [];            // buffered targetToken events, flushed per microtask
    this._flushScheduled = false;
    this._suppress = false;        // true while we re-assert targets ourselves
    this.resolve = null;
    this.reject = null;
    this._targetCount = game.user.targets.size;
    this._maxTargets = targets;

    const targetTool = document.querySelector('.control.tool[data-tool="target"]')
    targetTool?.click();

    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.targetHook = Hooks.on("targetToken", (user, token, targeted) => {
      if (user !== game.user) return;
      if (this._suppress) return;                 // ignore events from our own re-assert
      if (!this.stack) return this.checkComplete();
      // Plain clicks replace/toggle the single target set, firing a synchronous burst of
      // targetToken events per click. Buffer them and disambiguate on the next microtask.
      this._pending.push({ token, targeted });
      if (!this._flushScheduled) {
        this._flushScheduled = true;
        Promise.resolve().then(() => this._flushPending());
      }
    });

    this.movelistener = (event) => {
        this.update(event);
    };
    this.clicklistener = (event) => {
      if (event.which !== 3) return;
      if (this.stack) {
        // Read the hovered token BEFORE touching control/targets — re-selecting the caster clears
        // the goblin's hover, so getHoveredToken() must run first.
        const token = this.getHoveredToken();
        if (token && (this.distribution.get(token) ?? 0) > 0) {
          const cur = this.distribution.get(token);
          if (cur - 1 <= 0) this.distribution.delete(token);
          else this.distribution.set(token, cur - 1);
          // Core's right-click just controlled the token (deselecting the caster) + opened its HUD;
          // undo that. Same tick, so it renders once (no flicker).
          this._restoreControl();
          this._refresh();
          return;
        }
        this._restoreControl();                   // non-decrement right-click on a token: restore, then cancel
      }
      this.end(false);                            // empty right-click (or non-stacking) cancels
    };
    this.keyuplistener = (event) => {
      if (event.key === "Escape") return this.end(false);
      if (this.stack) return;                     // no maxTargets nudging while stacking
      if (event.key === "+" || event.key === "=") {
        this.maxTargets++;
      }
      if (event.key === "-" || event.key === "_") {
        if (this.maxTargets > 1) this.maxTargets--;
      }
    };
    document.addEventListener("mousemove", this.movelistener);
    document.addEventListener("mouseup", this.clicklistener);
    document.addEventListener("keyup", this.keyuplistener);
    this.init();
  }

  checkComplete() {
      this.targetCount = game.user.targets.size;
      if (this.targetCount >= this.maxTargets) {
          this.end(true);
      }
  }

  // Resolve which token a click's event-burst refers to (stacking mode).
  _flushPending() {
    this._flushScheduled = false;
    const events = this._pending;
    this._pending = [];
    if (!events.length) return;
    const trueEv = events.find(e => e.targeted);
    let clicked = null;
    if (trueEv) clicked = trueEv.token;                 // replace-mode targets the clicked token
    else if (events.length === 1) clicked = events[0].token; // lone release = re-click same token
    // multiple releases with no target = a deselect/clear -> ignore (re-assert restores state)
    if (clicked) this.distribution.set(clicked, (this.distribution.get(clicked) ?? 0) + 1);
    this._refresh();
  }

  distributionTotal() {
    let n = 0;
    for (const c of this.distribution.values()) n += c;
    return n;
  }

  getHoveredToken() {
    return canvas.tokens.placeables.find(t => t.hover) ?? null;
  }

  // Re-select the caster token(s) and dismiss the token HUD that a right-click on a token opened.
  _restoreControl() {
    try { const hud = canvas.tokens?.hud; if (hud?.rendered) hud.close(); } catch (e) { /* no-op */ }
    const ctrl = (this._controlled ?? []).map(id => canvas.tokens.get(id)).filter(Boolean);
    ctrl.forEach((t, i) => t.control({ releaseOthers: i === 0 }));
  }

  // Keep the user's targets synced to our distribution (all stacked tokens targeted), update the
  // label, and complete when full. The re-assert is guarded so its own events aren't re-counted.
  _reassertTargets() {
    const ids = [...this.distribution.keys()].map(t => t.id);
    this._suppress = true;
    canvas.tokens.setTargets(ids, { mode: "replace" });
    this._suppress = false;
  }

  // Per-token count badges (BG3-style pips) shown on each token during a stacking pick.
  drawBadges() {
    for (const token of canvas.tokens.placeables) {
      const count = this.distribution.get(token) ?? 0;
      if (count > 0) {
        if (!token._echStackBadge) {
          const style = CONFIG.canvasTextStyle.clone();
          style.fontSize = 36;
          style.fill = "#ffffff";
          style.stroke = "#000000";
          style.strokeThickness = 6;
          const badge = new foundry.canvas.containers.PreciseText(String(count), style);
          badge.anchor.set(0.5);
          badge.eventMode = "none";
          token.addChild(badge);
          token._echStackBadge = badge;
        }
        token._echStackBadge.text = String(count);
        token._echStackBadge.position.set(token.w / 2, token.h / 2);
        token._echStackBadge.visible = true;
      } else if (token._echStackBadge) {
        token._echStackBadge.destroy();
        delete token._echStackBadge;
      }
    }
  }

  clearBadges() {
    for (const token of canvas.tokens.placeables) {
      if (token._echStackBadge) {
        token._echStackBadge.destroy();
        delete token._echStackBadge;
      }
    }
  }

  _refresh() {
    this._targetCount = this.distributionTotal();
    this._reassertTargets();
    this.drawBadges();
    this.update();
    if (this._targetCount >= this.maxTargets) this.end(true);
  }

  set targetCount(count) {
    this._targetCount = count;
    this.update();
  }

  get targetCount() {
    return this._targetCount;
  }

  set maxTargets(count) {
    this._maxTargets = count;
    this.update();
    this.checkComplete();
  }

  get maxTargets() {
    return this._maxTargets;
  }

  init() {
    if(game.settings.get("enhancedcombathud", "rangepickerclear")) {
      // The initial wipe is our own action: each release fires targetToken synchronously, and
      // with more pre-targets than maxTargets the intermediate sizes would complete the picker
      // before the user picks anything (stacking: buffer phantom clicks). Suppress the hook for
      // the wipe, then re-sync the count snapshotted pre-wipe in the constructor.
      this._suppress = true;
      game.user.targets.forEach(t => t.setTarget(false, { releaseOthers: true }));
      this._suppress = false;
      this._targetCount = game.user.targets.size;
    }
    const element = document.createElement("div");
    element.classList.add("ech-target-picker");
    document.body.appendChild(element);
    this.element = element;
    if (!this.maxTargets || this.targetCount == this.maxTargets) return this.end(true);
    const tokenSizeOffset = Math.max(this.token.document.width, this.token.document.height) * 0.5 * canvas.scene.dimensions.distance;
    showRangeRings(this.ranges.normal, this.ranges.long, this.token, tokenSizeOffset);
  }

  update(event) {
    if(!this.element) return;
    if (event) {
      const clientX = event.clientX;
      const clientY = event.clientY;
      this.element.style.left = clientX + 20 + "px";
      this.element.style.top = clientY + "px";
    }
    this.element.innerText = `${this.targetCount}/${this.maxTargets} Targets`;
  }

  end(res) {
    Hooks.off("targetToken", this.targetHook);          // stop counting before we touch targets
    this.clearBadges();
    document.removeEventListener("mousemove", this.movelistener);
    document.removeEventListener("mouseup", this.clicklistener);
    document.removeEventListener("keyup", this.keyuplistener);
    clearRanges(true);
    document.querySelector(".control.tool").click();
    activeTargetPicker = null;
    if (this.stack) {
      if (res) {
        // targets already reflect the distribution (kept in sync by _reassertTargets); publish it
        const map = new Map();
        for (const [token, count] of this.distribution) map.set(token.id, count);
        const api = (game.modules.get("enhancedcombathud").api ??= {});
        api.lastTargetDistribution = { itemUuid: this.item?.uuid ?? null, map, timestamp: Date.now() };
      } else {
        canvas.tokens.setTargets([], { mode: "replace" }); // clear on cancel
      }
    }
    this.resolve(res);
    this.element.remove();
    document.querySelector('.control.tool[data-tool="select"]')?.click();
  }
}

function checkShowTargetPickerGuide() {
  if (!game.settings.get("enhancedcombathud", "targetPickerGuideShown")) {
    window.ui.ARGON.showTargetPickerGuide();
  }
}

export async function showTargetPickerGuide() {
  let list = "";
  const elementsCount = 4;
  for (let i = 0; i < elementsCount; i++) {
    list += `<li class="notification info" style="font-weight: 900">${game.i18n.localize(`enhancedcombathud.targetPicker.dialog.list.${i}`)}</li>`;
  }
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("enhancedcombathud.targetPicker.dialog.title") },
    content: `<ul class="guide-list" style="list-style:none;padding:0">${list}</ul>`,
    close: () => {return false},
  });
  if(result) game.settings.set("enhancedcombathud", "targetPickerGuideShown", true);
}
