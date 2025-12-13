#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { getWindowInfo } from "../tmux.ts";

function calculatePopupSize(window: { width: number; height: number }): {
  width: number;
  height: number;
} {
  // Force even width for centering
  const width = Math.floor(window.width * 0.8) & ~1;
  // Scale height proportionally, then add rows for header/footer chrome
  const chromeRows = 6;
  const scaledHeight = Math.floor(window.height * 0.8);
  const height = scaledHeight + chromeRows;

  return { width, height };
}

function openPopup(size: { width: number; height: number }): void {
  const uiPath = new URL("./cmuxx-ui.ts", import.meta.url).pathname;
  execSync(
    `tmux display-popup -w ${size.width} -h ${size.height} -E ${uiPath}`,
    { stdio: "inherit" }
  );
}

function main(): void {
  const { width, height } = getWindowInfo();
  const popupSize = calculatePopupSize({ width, height });
  openPopup(popupSize);
}

main();
