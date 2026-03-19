import Foundation
import Vision
import AppKit

struct OcrLine: Codable {
    let text: String
    let confidence: Double
    let x: Double
    let y: Double
}

struct OcrPayload: Codable {
    let ok: Bool
    let source: String
    let lineCount: Int
    let fullText: String
    let lines: [OcrLine]
}

func usage() -> Never {
    fputs("Usage: ocr-image-text.swift --url <image-url> | --path <image-path>\n", stderr)
    exit(1)
}

var sourcePath: String? = nil
var sourceUrl: String? = nil
var idx = 1
while idx < CommandLine.arguments.count {
    let arg = CommandLine.arguments[idx]
    if arg == "--url" {
        idx += 1
        guard idx < CommandLine.arguments.count else { usage() }
        sourceUrl = CommandLine.arguments[idx]
    } else if arg == "--path" {
        idx += 1
        guard idx < CommandLine.arguments.count else { usage() }
        sourcePath = CommandLine.arguments[idx]
    } else if arg == "--help" || arg == "-h" {
        usage()
    } else {
        usage()
    }
    idx += 1
}

guard sourcePath != nil || sourceUrl != nil else {
    usage()
}

let imageData: Data
let source: String

if let sourceUrl {
    guard let url = URL(string: sourceUrl) else {
        fputs("Invalid URL: \(sourceUrl)\n", stderr)
        exit(1)
    }
    do {
        imageData = try Data(contentsOf: url)
        source = sourceUrl
    } catch {
        fputs("Failed to download image: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else if let sourcePath {
    let expandedPath = NSString(string: sourcePath).expandingTildeInPath
    do {
        imageData = try Data(contentsOf: URL(fileURLWithPath: expandedPath))
        source = expandedPath
    } catch {
        fputs("Failed to read image: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else {
    usage()
}

guard let image = NSImage(data: imageData) else {
    fputs("Unable to decode image data.\n", stderr)
    exit(1)
}

var imageRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &imageRect, context: nil, hints: nil) else {
    fputs("Unable to create CGImage.\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("OCR request failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}

let observations = request.results ?? []
let lines = observations
    .compactMap { observation -> OcrLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let box = observation.boundingBox
        return OcrLine(
            text: text,
            confidence: Double(candidate.confidence),
            x: Double(box.minX),
            y: Double(box.midY)
        )
    }
    .sorted { left, right in
        if abs(left.y - right.y) > 0.02 {
            return left.y > right.y
        }
        return left.x < right.x
    }

let payload = OcrPayload(
    ok: true,
    source: source,
    lineCount: lines.count,
    fullText: lines.map(\.text).joined(separator: "\n"),
    lines: lines
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
do {
    let data = try encoder.encode(payload)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
} catch {
    fputs("Failed to encode OCR payload: \(error.localizedDescription)\n", stderr)
    exit(1)
}
