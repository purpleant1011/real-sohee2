
import { ChannelKey } from "../types";

export interface VideoAssetMetadata {
  rawVideoUrl: string;
  originalDurationSec: number;
  hookText: string;
  mainCaption: string;
  callToAction: string;
  tags: string[];
}

export interface ChannelVideoVariant {
  channelKey: ChannelKey;
  aspectRatio: "9:16" | "1:1" | "16:9";
  targetDurationSec: number;
  safeAreaMarginPx: { top: number; bottom: number; left: number; right: number };
  adaptedHook: string;
  adaptedCaption: string;
  mode: "api_direct" | "assisted_export";
}

export function compileVideoVariants(asset: VideoAssetMetadata): Record<string, ChannelVideoVariant> {
  return {
    instagram_reels: {
      channelKey: "instagram",
      aspectRatio: "9:16",
      targetDurationSec: Math.min(30, asset.originalDurationSec),
      safeAreaMarginPx: { top: 100, bottom: 120, left: 40, right: 40 },
      adaptedHook: asset.hookText,
      adaptedCaption: asset.mainCaption + "\n\n" + asset.tags.join(" "),
      mode: "api_direct",
    },
    youtube_shorts: {
      channelKey: "google_business",
      aspectRatio: "9:16",
      targetDurationSec: Math.min(60, asset.originalDurationSec),
      safeAreaMarginPx: { top: 80, bottom: 100, left: 30, right: 30 },
      adaptedHook: asset.hookText,
      adaptedCaption: asset.mainCaption,
      mode: "assisted_export",
    },
    tiktok: {
      channelKey: "daangn",
      aspectRatio: "9:16",
      targetDurationSec: Math.min(15, asset.originalDurationSec),
      safeAreaMarginPx: { top: 120, bottom: 140, left: 40, right: 60 },
      adaptedHook: asset.hookText,
      adaptedCaption: asset.mainCaption,
      mode: "assisted_export",
    },
  };
}
