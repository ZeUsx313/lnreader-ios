import AVFoundation
import ExpoModulesCore
import Foundation

/**
 * iOS implementation of the volume-button listener.
 *
 * iOS provides no public API to intercept the hardware volume keys without
 * changing system volume. The closest public mechanism is observing
 * AVAudioSession.outputVolume via KVO, which fires on every volume-button
 * press (the system volume still changes — this is an iOS platform
 * limitation, documented in docs/ios-port/LIMITATIONS.md).
 */
public class NativeVolumeButtonListenerModule: Module {
  private var observation: NSKeyValueObservation?
  private var lastVolume: Float = 0

  public func definition() -> ModuleDefinition {
    Name("NativeVolumeButtonListener")

    Events("VolumeUp", "VolumeDown")

    Function("setActive") { (active: Bool) in
      if active {
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
        try? AVAudioSession.sharedInstance().setActive(true)
        self.lastVolume = AVAudioSession.sharedInstance().outputVolume

        self.observation?.invalidate()
        self.observation = AVAudioSession.sharedInstance().observe(
          \.outputVolume,
          options: [.new]
        ) { [weak self] session, _ in
          guard let self = self else { return }
          let newVolume = session.outputVolume
          // Same volume (e.g. already at max/min) produces no event —
          // direction cannot be derived without a change.
          if newVolume == self.lastVolume {
            return
          }
          let event = newVolume > self.lastVolume ? "VolumeUp" : "VolumeDown"
          self.lastVolume = newVolume
          self.sendEvent(event)
        }
      } else {
        self.observation?.invalidate()
        self.observation = nil
      }
    }

    OnDestroy {
      self.observation?.invalidate()
      self.observation = nil
    }
  }
}
