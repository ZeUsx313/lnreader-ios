import ExpoModulesCore
import Foundation
import ZIPFoundation

/**
 * iOS implementation of the NativeZipArchive module.
 *
 * Mirrors the Android semantics exactly:
 *  - unzip(sourceFilePath, distDirPath): extract archive contents into distDirPath.
 *  - zip(sourceDirPath, zipFilePath): archive the CONTENTS of sourceDirPath
 *    (entries are relative to the source dir, matching the Kotlin walkBottomUp).
 *  - remoteUnzip(distDirPath, url, headers): stream-download a zip and extract it.
 *  - remoteZip(sourceDirPath, url, headers): POST a zip of sourceDirPath as the
 *    request body and resolve with the response body text (HTTP 200 required).
 */
public class NativeZipArchiveModule: Module {
  private let fileManager = FileManager.default

  public func definition() -> ModuleDefinition {
    Name("NativeZipArchive")

    AsyncFunction("unzip") { (sourceFilePath: String, distDirPath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try self.unzipArchive(at: sourceFilePath, toDirectory: distDirPath)
          promise.resolve(nil)
        } catch {
          promise.reject("UNZIP_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("zip") { (sourceDirPath: String, zipFilePath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try self.zipDirectory(sourceDirPath, to: zipFilePath)
          promise.resolve(nil)
        } catch {
          promise.reject("ZIP_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("remoteUnzip") {
      (distDirPath: String, urlString: String, headers: [String: String], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let downloadedFile = try self.httpDownload(urlString: urlString, headers: headers)
          defer { try? self.fileManager.removeItem(at: downloadedFile) }
          try self.unzipArchive(at: downloadedFile.path, toDirectory: distDirPath)
          promise.resolve(nil)
        } catch {
          promise.reject("REMOTE_UNZIP_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("remoteZip") {
      (sourceDirPath: String, urlString: String, headers: [String: String], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let temporaryZip = self.fileManager.temporaryDirectory
            .appendingPathComponent("lnreader-upload-\(UUID().uuidString).zip")
          defer { try? self.fileManager.removeItem(at: temporaryZip) }
          try self.zipDirectory(sourceDirPath, to: temporaryZip.path)
          let responseBody = try self.httpUpload(
            file: temporaryZip,
            urlString: urlString,
            headers: headers
          )
          promise.resolve(with: responseBody)
        } catch {
          promise.reject("REMOTE_ZIP_FAILED", error.localizedDescription)
        }
      }
    }
  }

  // MARK: - Archive helpers

  private func unzipArchive(at sourceFilePath: String, toDirectory distDirPath: String) throws {
    let sourceURL = URL(fileURLWithPath: sourceFilePath)
    let destinationURL = URL(fileURLWithPath: distDirPath, isDirectory: true)

    guard fileManager.fileExists(atPath: sourceFilePath) else {
      throw NSError(
        domain: "NativeZipArchive", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Source archive does not exist: \(sourceFilePath)"]
      )
    }

    try fileManager.createDirectory(at: destinationURL, withIntermediateDirectories: true)
    try fileManager.unzipItem(at: sourceURL, to: destinationURL)
  }

  /// Archives the CONTENTS of `sourceDirPath` (no root folder prefix),
  /// matching the Android `walkBottomUp` behaviour.
  private func zipDirectory(_ sourceDirPath: String, to zipFilePath: String) throws {
    let sourceURL = URL(fileURLWithPath: sourceDirPath, isDirectory: true)
    let zipURL = URL(fileURLWithPath: zipFilePath)

    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: sourceDirPath, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      throw NSError(
        domain: "NativeZipArchive", code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Source directory does not exist: \(sourceDirPath)"]
      )
    }

    let parentDirectory = zipURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: parentDirectory, withIntermediateDirectories: true)
    if fileManager.fileExists(atPath: zipURL.path) {
      try fileManager.removeItem(at: zipURL)
    }

    try fileManager.zipItem(at: sourceURL, to: zipURL, shouldKeepParent: false)
  }

  // MARK: - Network helpers

  private func makeRequest(urlString: String, headers: [String: String]) throws -> URLRequest {
    guard let url = URL(string: urlString) else {
      throw NSError(
        domain: "NativeZipArchive", code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(urlString)"]
      )
    }
    var request = URLRequest(url: url)
    headers.forEach { key, value in
      request.setValue(value, forHTTPHeaderField: key)
    }
    return request
  }

  private func httpDownload(urlString: String, headers: [String: String]) throws -> URL {
    var request = try makeRequest(urlString: urlString, headers: headers)
    request.httpMethod = "GET"

    let semaphore = DispatchSemaphore(value: 0)
    var resultUrl: URL?
    var resultError: Error?
    var statusCode = 0

    let task = URLSession.shared.downloadTask(with: request) { location, response, error in
      defer { semaphore.signal() }
      resultError = error
      if let http = response as? HTTPURLResponse {
        statusCode = http.statusCode
      }
      if let location = location {
        let target = FileManager.default.temporaryDirectory
          .appendingPathComponent("lnreader-download-\(UUID().uuidString)")
        do {
          try? FileManager.default.removeItem(at: target)
          try FileManager.default.moveItem(at: location, to: target)
          resultUrl = target
        } catch {
          resultError = error
        }
      }
    }
    task.resume()
    semaphore.wait()

    if let error = resultError {
      throw error
    }
    guard statusCode == 200, let resultUrl = resultUrl else {
      throw NSError(
        domain: "NativeZipArchive", code: 4,
        userInfo: [NSLocalizedDescriptionKey: "Network request failed (HTTP \(statusCode))"]
      )
    }
    return resultUrl
  }

  private func httpUpload(file: URL, urlString: String, headers: [String: String]) throws
    -> String
  {
    var request = try makeRequest(urlString: urlString, headers: headers)
    request.httpMethod = "POST"

    let semaphore = DispatchSemaphore(value: 0)
    var responseData = Data()
    var resultError: Error?
    var statusCode = 0

    let task = URLSession.shared.uploadTask(
      with: request,
      fromFile: file
    ) { data, response, error in
      defer { semaphore.signal() }
      resultError = error
      responseData = data ?? Data()
      if let http = response as? HTTPURLResponse {
        statusCode = http.statusCode
      }
    }
    task.resume()
    semaphore.wait()

    if let error = resultError {
      throw error
    }
    guard statusCode == 200 else {
      throw NSError(
        domain: "NativeZipArchive", code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Network request failed (HTTP \(statusCode))"]
      )
    }
    return String(data: responseData, encoding: .utf8) ?? ""
  }
}
