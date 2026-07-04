// =============================================================
// Myco Lab — Push notification registration
//
// Frontend groundwork for FCM. The backend token exchange
// (POST /api/devices/register) will be wired in a future sprint;
// this file only handles the Capacitor-side registration flow.
// =============================================================

import { Capacitor } from '@capacitor/core'
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications'

// ─────────────────────────────────────────────────────────────
// RESULT TYPE
// ─────────────────────────────────────────────────────────────

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: string }

// ─────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────

/**
 * Register for push notifications on native (Android) only.
 * Web falls through to a no-op result.
 *
 * The actual FCM token does not arrive on this promise — it is
 * delivered asynchronously via the `registration` event in
 * `attachPushListeners`. The token string returned here is
 * intentionally empty; consumers must use the listener.
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  if (Capacitor.getPlatform() !== 'android') {
    return { ok: false, reason: 'push_notifications_android_only' }
  }

  let permStatus = await PushNotifications.checkPermissions()
  if (permStatus.receive === 'prompt') {
    permStatus = await PushNotifications.requestPermissions()
  }
  if (permStatus.receive !== 'granted') {
    return { ok: false, reason: 'permission_denied' }
  }

  await PushNotifications.register()
  return { ok: true, token: '' } // token arrives via 'registration' listener
}

// ─────────────────────────────────────────────────────────────
// LISTENERS
// ─────────────────────────────────────────────────────────────

interface PushListeners {
  onRegistration?: (token: Token) => void
  onRegistrationError?: (err: unknown) => void
  onPushReceived?: (n: PushNotificationSchema) => void
  onActionPerformed?: (a: ActionPerformed) => void
}

/**
 * Attach the standard four push-notification listeners. Returns
 * a teardown function. Call once at app boot.
 *
 *   - `registration`             → FCM/APNs token ready
 *   - `registrationError`        → token fetch failed
 *   - `pushNotificationReceived` → notification delivered while app is foreground
 *   - `pushNotificationActionPerformed` → user tapped a notification action
 *
 * `addListener` returns a Promise<PluginListenerHandle> on the
 * `@capacitor/push-notifications` plugin, so each handle is awaited
 * before being stashed in the teardown closure.
 */
export async function attachPushListeners(
  handlers: PushListeners = {}
): Promise<() => void> {
  const regListener = await PushNotifications.addListener(
    'registration',
    (token) => handlers.onRegistration?.(token)
  )
  const errListener = await PushNotifications.addListener(
    'registrationError',
    (err) => handlers.onRegistrationError?.(err)
  )
  const recvListener = await PushNotifications.addListener(
    'pushNotificationReceived',
    (notification) => handlers.onPushReceived?.(notification)
  )
  const actListener = await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => handlers.onActionPerformed?.(action)
  )

  return () => {
    regListener.remove()
    errListener.remove()
    recvListener.remove()
    actListener.remove()
  }
}
