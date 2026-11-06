import { Platform, ToastAndroid } from 'react-native';

type ToastListener = (message: string) => void;

let listener: ToastListener | null = null;

/**
 * Registers the iOS toast host (ToastHost component mounted in App).
 * ToastAndroid has no iOS equivalent, so the app renders an in-JS toast
 * overlay instead of crashing on `ToastAndroid.show`.
 */
export const setToastListener = (next: ToastListener | null) => {
  listener = next;
};

export const showToast = (...message: string[]) => {
  const text = message.join(' ');
  if (Platform.OS === 'android') {
    ToastAndroid.show(text, ToastAndroid.SHORT);
  } else {
    listener?.(text);
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.trace('Toast: ', message);
  }
};
