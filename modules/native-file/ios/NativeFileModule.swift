import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

/**
 * iOS implementation of the NativeFile module.
 *
 * This file completes the iOS port of the Android module:
 *  - downloadFile: real URLSession-based downloader (method/headers/body/cookies).
 *  - createDocument / pickDocument / pickDirectory: UIDocumentPicker-based
 *    equivalents of the Android SAF flows.
 *  - BundlePath: absolute path of the app bundle (used by the reader WebView).
 *  - Security-scoped bookmark support so picked directories keep working
 *    across launches (mirrors Android's persisted SAF tree URIs).
 */
public class NativeFileModule: Module {
  /// UserDefaults suite storing security-scoped bookmarks keyed by path.
  private var bookmarksDefaults: UserDefaults? {
    UserDefaults(suiteName: "NativeFileBookmarks")
  }

  public func definition() -> ModuleDefinition {
    Name("NativeFile")

    Function("writeFile") { (path: String, content: String) in
      try self.withSecurityScope(path: path) { url in
        try content.write(to: url, atomically: true, encoding: .utf8)
      }
    }

    Function("readFile") { (path: String) in
      try self.withSecurityScope(path: path) { url in
        try String(contentsOf: url, encoding: .utf8)
      }
    }

    Function("copyFile") { (sourcePath: String, destPath: String) in
      let fileManager = FileManager.default
      let sourceURL = URL(fileURLWithPath: sourcePath)
      let destinationURL = URL(fileURLWithPath: destPath)

      if fileManager.fileExists(atPath: destinationURL.path) {
        try fileManager.removeItem(at: destinationURL)
      }
      try fileManager.copyItem(at: sourceURL, to: destinationURL)
    }

    AsyncFunction("copyFileToDirectory") { (sourcePath: String, directoryUri: String, fileName: String, mimeType: String, replace: Bool) -> [String: Any] in
      _ = mimeType
      return try self.withSecurityScope(path: directoryUri) { directory in
        try self.copyFileToDirectory(
          sourcePath: sourcePath,
          directoryUrl: directory,
          fileName: fileName,
          replace: replace
        )
      }
    }

    Function("moveFile") { (sourcePath: String, destPath: String) in
      let fileManager = FileManager.default
      let sourceURL = URL(fileURLWithPath: sourcePath)
      let destinationURL = URL(fileURLWithPath: destPath)

      if fileManager.fileExists(atPath: destinationURL.path) {
        try fileManager.removeItem(at: destinationURL)
      }
      try fileManager.moveItem(at: sourceURL, to: destinationURL)
    }

    Function("exists") { (filePath: String) in
      FileManager.default.fileExists(atPath: filePath)
    }

    Function("mkdir") { (filePath: String) in
      try FileManager.default.createDirectory(atPath: filePath, withIntermediateDirectories: true, attributes: nil)
    }

    Function("unlink") { (filePath: String) in
      try self.withSecurityScope(path: filePath) { url in
        try FileManager.default.removeItem(at: url)
      }
    }

    Function("readDir") { (dirPath: String) -> [[String: Any]] in
      let contents = try FileManager.default.contentsOfDirectory(atPath: dirPath)
      return contents.map { fileName in
        let path = (dirPath as NSString).appendingPathComponent(fileName)
        var isDirectory: ObjCBool = false
        FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
        return [
          "name": fileName,
          "path": path,
          "isDirectory": isDirectory.boolValue
        ]
      }
    }

    AsyncFunction("downloadFile") { (url: String, destPath: String, method: String, headers: [String: String], body: String?, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try self.downloadToFile(
            url: url,
            destPath: destPath,
            method: method,
            headers: headers,
            body: body
          )
          promise.resolve(nil)
        } catch {
          promise.reject("DOWNLOAD_FAILED", error.localizedDescription, error)
        }
      }
    }

    /// Creates a new empty document at a user-chosen location (equivalent of
    /// Android's ACTION_CREATE_DOCUMENT). Returns the file path to write into.
    AsyncFunction("createDocument") { (filename: String, mimeType: String, promise: Promise) in
      DispatchQueue.main.async {
        // The exporter accepts existing file URLs, not UTType values.
        // Stage an empty document so the user can choose its destination.
        _ = mimeType
        let safeName = (filename as NSString).lastPathComponent
        let stagedFile = FileManager.default.temporaryDirectory
          .appendingPathComponent(safeName.isEmpty ? "LNReader.txt" : safeName)
        if !FileManager.default.fileExists(atPath: stagedFile.path) {
          guard FileManager.default.createFile(atPath: stagedFile.path, contents: Data()) else {
            promise.reject("CREATE_FAILED", "Unable to prepare export document")
            return
          }
        }
        let picker = UIDocumentPickerViewController(forExporting: [stagedFile], asCopy: true)
        picker.nameFieldStringValue = filename
        Self.presentPicker(picker) { urls in
          guard let url = urls.first else {
            promise.reject("USER_CANCELED", "No document selected")
            return
          }
          self.storeBookmarkIfSecurityScoped(url)
          if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: Data())
          }
          promise.resolve(url.path)
        }
      }
    }

    /// Opens a user-chosen document (equivalent of Android's ACTION_OPEN_DOCUMENT).
    /// Returns a readable file path.
    AsyncFunction("pickDocument") { (mimeType: String, promise: Promise) in
      DispatchQueue.main.async {
        let utType = Self.utType(forMimeType: mimeType) ?? .data
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [utType], asCopy: true)
        Self.presentPicker(picker) { urls in
          guard let url = urls.first else {
            promise.reject("USER_CANCELED", "No document selected")
            return
          }
          promise.resolve(url.path)
        }
      }
    }

    /// Opens a user-chosen directory (equivalent of Android's OPEN_DOCUMENT_TREE).
    /// Returns {uri, name}; access persists across launches via bookmarks.
    AsyncFunction("pickDirectory") { (promise: Promise) in
      DispatchQueue.main.async {
        let picker = UIDocumentPickerViewController(
          forOpeningContentTypes: [.folder],
          asCopy: false
        )
        Self.presentPicker(picker) { urls in
          guard let url = urls.first else {
            promise.reject("USER_CANCELED", "No directory selected")
            return
          }
          self.storeBookmarkIfSecurityScoped(url)
          promise.resolve(["uri": url.path, "name": url.lastPathComponent])
        }
      }
    }

    Constant("DocumentDirectoryPath") {
      let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
      return paths.first ?? ""
    }

    Constant("ExternalDirectoryPath") {
      let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
      return paths.first ?? ""
    }

    Constant("ExternalCachesDirectoryPath") {
      let paths = NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true)
      return paths.first ?? ""
    }

    Constant("BundlePath") {
      Bundle.main.bundlePath
    }
  }

  // MARK: - Copy to directory

  private func copyFileToDirectory(
    sourcePath: String,
    directoryUrl: URL,
    fileName: String,
    replace: Bool
  ) throws -> [String: Any] {
    guard !fileName.isEmpty,
      fileName != ".",
      fileName != "..",
      !fileName.contains("/"),
      !fileName.contains("\\")
    else {
      throw NSError(
        domain: "NativeFile",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid destination file name"]
      )
    }

    let fileManager = FileManager.default
    let sourceURL = URL(fileURLWithPath: sourcePath)
    let destinationURL = directoryUrl.appendingPathComponent(fileName)
    let stagingURL = directoryUrl.appendingPathComponent(".\(fileName).\(UUID().uuidString).tmp")

    guard fileManager.fileExists(atPath: directoryUrl.path) else {
      throw NSError(
        domain: "NativeFile",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Destination directory does not exist"]
      )
    }
    if fileManager.fileExists(atPath: destinationURL.path) && !replace {
      throw CocoaError(.fileWriteFileExists)
    }

    defer { try? fileManager.removeItem(at: stagingURL) }
    try fileManager.copyItem(at: sourceURL, to: stagingURL)
    let attributes = try fileManager.attributesOfItem(atPath: stagingURL.path)
    let copiedSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0

    if fileManager.fileExists(atPath: destinationURL.path) {
      _ = try fileManager.replaceItemAt(destinationURL, withItemAt: stagingURL)
    } else {
      try fileManager.moveItem(at: stagingURL, to: destinationURL)
    }
    return ["uri": destinationURL.absoluteString, "size": copiedSize]
  }

  // MARK: - Download

  private func downloadToFile(
    url: String,
    destPath: String,
    method: String,
    headers: [String: String],
    body: String?
  ) throws {
    guard let requestUrl = URL(string: url) else {
      throw NSError(
        domain: "NativeFile", code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(url)"]
      )
    }

    var request = URLRequest(url: requestUrl)
    request.httpMethod = method.uppercased()
    request.httpShouldHandleCookies = true
    headers.forEach { key, value in
      request.setValue(value, forHTTPHeaderField: key)
    }
    if let body = body, !body.isEmpty {
      request.httpBody = body.data(using: .utf8)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var resultData: Data?
    var resultError: Error?
    var statusCode = 0

    // .default configuration shares HTTPCookieStorage with RN networking,
    // so cookies collected by the app/webview are reused (mirrors the
    // Android OkHttp cookie jar behaviour).
    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      resultError = error
      resultData = data
      if let http = response as? HTTPURLResponse {
        statusCode = http.statusCode
      }
    }
    task.resume()
    semaphore.wait()

    if let error = resultError {
      throw error
    }
    guard let data = resultData, statusCode == 200 else {
      throw NSError(
        domain: "NativeFile", code: 4,
        userInfo: [NSLocalizedDescriptionKey: "Network request failed (HTTP \(statusCode))"]
      )
    }

    let destinationURL = URL(fileURLWithPath: destPath)
    let parentDirectory = destinationURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parentDirectory, withIntermediateDirectories: true)
    try data.write(to: destinationURL, options: .atomic)
  }

  // MARK: - Security-scoped bookmarks

  private func storeBookmarkIfSecurityScoped(_ url: URL) {
    let needsBookmark = url.path.starts(with: "/private/var/mobile")
      || url.path.starts(with: "/var/mobile")
    guard needsBookmark else {
      return
    }
    do {
      let bookmark = try url.bookmarkData()
      bookmarksDefaults?.set(bookmark, forKey: url.path)
    } catch {
      // Non-fatal: some locations remain accessible without a bookmark.
    }
  }

  private func resolveSecurityScopedURL(for path: String) -> URL? {
    let url = URL(fileURLWithPath: path)
    if FileManager.default.fileExists(atPath: path) {
      return url
    }
    // The file itself may not exist yet (e.g. creating a new file inside a
    // picked directory) — fall back to the closest bookmarked ancestor.
    var candidate = url.deletingLastPathComponent()
    while candidate.path.count > 1 {
      if let bookmark = bookmarksDefaults?.data(forKey: candidate.path) {
        return resolveBookmark(bookmark, forKey: candidate.path)
      }
      let parent = candidate.deletingLastPathComponent()
      if parent.path == candidate.path {
        break
      }
      candidate = parent
    }
    guard let bookmark = bookmarksDefaults?.data(forKey: path) else {
      return nil
    }
    return resolveBookmark(bookmark, forKey: path)
  }

  private func resolveBookmark(_ bookmark: Data, forKey key: String) -> URL? {
    var isStale = false
    do {
      let resolved = try URL(
        resolvingBookmarkData: bookmark,
        options: [],
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
      )
      if isStale {
        if let refreshed = try? resolved.bookmarkData() {
          bookmarksDefaults?.set(refreshed, forKey: key)
        }
      }
      return resolved
    } catch {
      return nil
    }
  }

  /// Runs `body` with security scope started when the path belongs to a
  /// user-picked (sandboxed) location. Plain container paths run untouched.
  private func withSecurityScope<T>(path: String, body: (URL) throws -> T) throws -> T {
    let url = URL(fileURLWithPath: path)
    let scoped = resolveSecurityScopedURL(for: path)
    var started = false
    if let scoped = scoped {
      started = scoped.startAccessingSecurityScopedResource()
    }
    defer {
      if started {
        scoped?.stopAccessingSecurityScopedResource()
      }
    }
    return try body(url)
  }

  // MARK: - Picker presentation

  private static func utType(forMimeType mimeType: String) -> UTType? {
    if mimeType.isEmpty || mimeType == "*/*" {
      return .data
    }
    return UTType(mimeType: mimeType)
      ?? UTType(filenameExtension: (mimeType as NSString).pathExtension)
  }

  private static func presentPicker(
    _ picker: UIDocumentPickerViewController,
    completion: @escaping ([URL]) -> Void
  ) {
    let delegate = PickerDelegateHolder(completion: completion)
    picker.delegate = delegate
    objc_setAssociatedObject(
      picker,
      &PickerDelegateHolder.associationKey,
      delegate,
      .OBJC_ASSOCIATION_RETAIN
    )
    picker.allowsMultipleSelection = false

    let rootViewController = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first(where: { $0.isKeyWindow })?
      .rootViewController
    if let rootViewController = rootViewController {
      var presenter = rootViewController
      while let next = presenter.presentedViewController {
        presenter = next
      }
      presenter.present(picker, animated: true)
    } else {
      completion([])
    }
  }
}

/// Retains itself on the picker via associated objects and forwards the result.
final class PickerDelegateHolder: NSObject, UIDocumentPickerDelegate {
  static var associationKey = "NativeFilePickerDelegate"

  private let completion: ([URL]) -> Void

  init(completion: @escaping ([URL]) -> Void) {
    self.completion = completion
    super.init()
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    completion(urls)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    completion([])
  }
}
