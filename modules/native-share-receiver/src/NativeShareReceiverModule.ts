import { Platform } from 'react-native';

import { NativeModule, requireNativeModule } from 'expo-modules-core';

export type NativeShareReceiverEvents = {
  SharedText: (payload: { text: string }) => void;
};

declare class NativeShareReceiverModule extends NativeModule<NativeShareReceiverEvents> {
  getInitialSharedText(): string | null;
}

type SharedTextListener = (payload: { text: string }) => void;

const listeners = new Set<SharedTextListener>();

/**
 * iOS has no Android-style ACTION_SEND intent handling; receiving shared
 * text requires a Share Extension target. Until that lands (tracked in
 * docs/ios-port/LIMITATIONS.md), this shim keeps the app fully functional
 * by returning "no shared text" instead of crashing on the missing native
 * module.
 */
const IosShareReceiverShim = {
  getInitialSharedText(): string | null {
    return null;
  },
  addListener(_eventName: string, listener: SharedTextListener) {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  },
  removeSubscription(subscription: { remove: () => void }) {
    subscription.remove();
  },
};

export default Platform.OS === 'android'
  ? requireNativeModule<NativeShareReceiverModule>('NativeShareReceiver')
  : (IosShareReceiverShim as unknown as NativeShareReceiverModule);
