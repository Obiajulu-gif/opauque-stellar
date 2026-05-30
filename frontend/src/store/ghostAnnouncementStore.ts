/**
 * Ghost manual receives that have been published on-chain via StealthAddressAnnouncer.
 * Used to hide the "Announce onchain" CTA after a successful run.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "opaque-ghost-announced";

export function ghostAnnouncementEntryKey(cluster: string, stealthAddress: string): string {
  return `${cluster}:${stealthAddress}`;
}

type State = {
  keys: Record<string, true>;
  markAnnounced: (cluster: string, stealthAddress: string) => void;
  isAnnounced: (cluster: string, stealthAddress: string) => boolean;
};

export const useGhostAnnouncementStore = create<State>()(
  persist(
    (set, get) => ({
      keys: {},
      markAnnounced: (cluster, stealthAddress) =>
        set((s) => ({
          keys: { ...s.keys, [ghostAnnouncementEntryKey(cluster, stealthAddress)]: true },
        })),
      isAnnounced: (cluster, stealthAddress) =>
        !!get().keys[ghostAnnouncementEntryKey(cluster, stealthAddress)],
    }),
    { name: STORAGE_KEY }
  )
);
