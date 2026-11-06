// js/volume.js
import { volumeSettings, saveVolumeSettings } from "./state.js";
import { sliderMaster, sliderBgm, sliderSfx, labelMaster, labelBgm, labelSfx } from "./dom.js";
import { audioManager } from "./audio.js";

function bindVolumeSlider(slider, label, key, applyToAudio) {
  if (!slider || !label) return;
  slider.value = String(volumeSettings[key]);
  label.textContent = String(volumeSettings[key]);

  slider.addEventListener("input", () => {
    const value = Number(slider.value);
    volumeSettings[key] = value;
    label.textContent = String(value);
    applyToAudio(value);
    saveVolumeSettings();
  });
}

export function setupVolumeControls() {
  bindVolumeSlider(sliderMaster, labelMaster, "master", (v) => audioManager.setMasterVolume(v));
  bindVolumeSlider(sliderBgm, labelBgm, "bgm", (v) => audioManager.setBgmVolume(v));
  bindVolumeSlider(sliderSfx, labelSfx, "sfx", (v) => audioManager.setSfxVolume(v));
}
